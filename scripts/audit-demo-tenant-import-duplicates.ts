/**
 * Audit demo-tenant pilot_lead_imports duplicates — DRY RUN ONLY.
 *
 * Purpose
 * -------
 * The cross-session dedupe in `importLeads()` (commit 2121e91) and the
 * post-upload summary card (commit 3e87634) prevent *future* duplicates, but
 * the Demo Dealership tenant already accumulated polluted rows from prior QA
 * re-uploads (the 4× Logan Stone / 4× Grace Turner stack, the 3× Mason /
 * Ava / Liam etc., and the original 12-row legacy seed: Brian Hardy, Ashley
 * Martin, …).
 *
 * This script *audits* that pollution without mutating anything. It groups
 * the tenant's `pilot_lead_imports` rows by the strongest available
 * dedupe key — normalized phone first, then valid normalized email — and
 * prints exactly which rows an APPLY-mode cleanup *would* exclude, while
 * keeping the oldest row in each group as the canonical record.
 *
 * Guarantees
 * ----------
 * - Read-only. The only DB operation is `db.select(...)`. There is no
 *   `db.insert` / `db.update` / `db.delete` import in this file.
 * - Refuses to run unless `VERIFY_TENANT_ID` matches the expected demo
 *   tenant id *exactly*. No `--apply` flag. No write mode of any kind.
 * - Scopes every query to that one tenant. Never reads other tenants' rows.
 * - Does not touch SMS / send / approval / launch / billing / auth / env /
 *   DNS / payment / settings code.
 *
 * Usage
 * -----
 *   # Will refuse with a non-zero exit code:
 *   npx tsx scripts/audit-demo-tenant-import-duplicates.ts
 *
 *   # Will run the dry-run report:
 *   VERIFY_TENANT_ID=26a3377e-3050-4487-955d-18025aed5fdb \
 *     npx tsx scripts/audit-demo-tenant-import-duplicates.ts
 */

import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from '../src/lib/db/schema'
import { normalizePhone, isValidNormalizedEmail } from '../src/lib/pilot/lead-import'

const { pilotLeadImports } = schema

// ─── Hard-coded safety values ─────────────────────────────────────────────────

/** Exact demo-tenant id. The script refuses any other value. */
const EXPECTED_TENANT_ID = '26a3377e-3050-4487-955d-18025aed5fdb'

/**
 * Legacy demo seed names — the original wall-of-warnings rows that pre-date
 * the guided-demo CSV. We report them separately so a future cleanup script
 * can decide whether to retire them, but this audit makes no recommendation
 * to delete them.
 */
const LEGACY_DEMO_NAMES = new Set<string>([
  'brian hardy',
  'ashley martin',
  'tyler bennett',
  'megan price',
  'noah jensen',
  'olivia carter',
  'ethan walker',
  'hannah reed',
  'jacob nielsen',
  'sofia garcia',
  'caleb moore',
  'emma young',
])

// ─── Refuse to run without explicit tenant id ─────────────────────────────────

const verifyTenantId = process.env.VERIFY_TENANT_ID

if (!verifyTenantId) {
  console.error('✗ Refusing to run: VERIFY_TENANT_ID is not set.')
  console.error('  Required: VERIFY_TENANT_ID=' + EXPECTED_TENANT_ID)
  console.error('  This script is a DRY RUN audit; it will not mutate data,')
  console.error('  but it also will not touch the DB until you confirm the')
  console.error('  tenant id you intend to audit.')
  process.exit(2)
}

if (verifyTenantId !== EXPECTED_TENANT_ID) {
  console.error('✗ Refusing to run: VERIFY_TENANT_ID does not match expected demo tenant.')
  console.error(`  expected: ${EXPECTED_TENANT_ID}`)
  console.error(`  received: ${verifyTenantId}`)
  console.error('  If you intended to audit a different tenant, edit')
  console.error('  EXPECTED_TENANT_ID in this script and have the change reviewed.')
  process.exit(2)
}

if (!process.env.DATABASE_URL) {
  console.error('✗ Refusing to run: DATABASE_URL is not set.')
  process.exit(2)
}

// ─── Read-only client ─────────────────────────────────────────────────────────

const sql = postgres(process.env.DATABASE_URL)
const db  = drizzle(sql, { schema })

// ─── Types & helpers ──────────────────────────────────────────────────────────

type ImportRow = {
  id:                  string
  firstName:           string
  lastName:            string
  phoneRaw:            string
  phone:               string | null
  email:               string | null
  vehicleOfInterest:   string | null
  importStatus:        string
  blockedReasons:      string[] | null
  warnings:            string[] | null
  duplicateOfImportId: string | null
  createdAt:           Date
  importedAt:          Date
}

type GroupKey =
  | { kind: 'phone'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'name+vehicle'; value: string }

type Group = {
  key:    GroupKey
  rows:   ImportRow[]
}

function fullName(r: ImportRow): string {
  return `${r.firstName} ${r.lastName}`.trim()
}
function lowerName(r: ImportRow): string {
  return fullName(r).toLowerCase()
}
function ageBucketStatus(r: ImportRow): string {
  return r.importStatus
}
function fmtDate(d: Date | null): string {
  return d ? d.toISOString() : '(null)'
}

/**
 * Normalize a phone column value for grouping. We use the same
 * normalizePhone() the importer uses, but fall back to the stored `phone`
 * column when it's already in E.164 form, so historical rows whose `phone_raw`
 * may not re-normalize cleanly still group correctly.
 */
function groupingPhone(r: ImportRow): string | null {
  if (r.phone && r.phone.startsWith('+') && r.phone.length >= 11) return r.phone
  if (r.phoneRaw) {
    const n = normalizePhone(r.phoneRaw)
    if (n) return n
  }
  return null
}

/**
 * Normalize an email column value for grouping. Mirrors the gate in
 * classifyImportDedupe() (commit 2121e91) — blank / no-@ / no-dot-in-domain
 * are ignored.
 */
function groupingEmail(r: ImportRow): string | null {
  const raw = (r.email ?? '').trim().toLowerCase()
  if (!raw) return null
  return isValidNormalizedEmail(raw) ? raw : null
}

/**
 * Recommended row to keep in a duplicate group: the *oldest* row by
 * createdAt (with importedAt as a secondary key, id as the tiebreaker).
 * This preserves the dealer's original intent and the original audit log.
 */
function pickKeep(rows: ImportRow[]): ImportRow {
  const sorted = [...rows].sort((a, b) => {
    const ca = a.createdAt.getTime()
    const cb = b.createdAt.getTime()
    if (ca !== cb) return ca - cb
    const ia = a.importedAt.getTime()
    const ib = b.importedAt.getTime()
    if (ia !== ib) return ia - ib
    return a.id.localeCompare(b.id)
  })
  return sorted[0]
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('● Demo-tenant pilot_lead_imports duplicate audit')
  console.log(`  tenant: ${EXPECTED_TENANT_ID}`)
  console.log(`  mode:   DRY RUN (read-only)`)
  console.log()

  // Single targeted SELECT against one tenant. No joins, no other tables.
  const rows: ImportRow[] = await db
    .select({
      id:                  pilotLeadImports.id,
      firstName:           pilotLeadImports.firstName,
      lastName:            pilotLeadImports.lastName,
      phoneRaw:            pilotLeadImports.phoneRaw,
      phone:               pilotLeadImports.phone,
      email:               pilotLeadImports.email,
      vehicleOfInterest:   pilotLeadImports.vehicleOfInterest,
      importStatus:        pilotLeadImports.importStatus,
      blockedReasons:      pilotLeadImports.blockedReasons,
      warnings:            pilotLeadImports.warnings,
      duplicateOfImportId: pilotLeadImports.duplicateOfImportId,
      createdAt:           pilotLeadImports.createdAt,
      importedAt:          pilotLeadImports.importedAt,
    })
    .from(pilotLeadImports)
    .where(eq(pilotLeadImports.tenantId, EXPECTED_TENANT_ID))

  console.log(`  total import rows for tenant: ${rows.length}`)
  console.log()

  // ── Tally rows by status, for orientation ─────────────────────────────────
  const byStatus = new Map<string, number>()
  for (const r of rows) {
    byStatus.set(r.importStatus, (byStatus.get(r.importStatus) ?? 0) + 1)
  }
  console.log('● Status tally:')
  for (const [status, n] of [...byStatus.entries()].sort()) {
    console.log(`  ${status.padEnd(16)}  ${n}`)
  }
  console.log()

  // ── Group by phone, then by email (only rows not already grouped) ─────────
  const phoneGroups = new Map<string, ImportRow[]>()
  const emailGroups = new Map<string, ImportRow[]>()
  const nameVehGroups = new Map<string, ImportRow[]>()
  const usedIds = new Set<string>()

  for (const r of rows) {
    const p = groupingPhone(r)
    if (p) {
      const list = phoneGroups.get(p) ?? []
      list.push(r)
      phoneGroups.set(p, list)
    }
  }
  for (const [, list] of phoneGroups) {
    if (list.length > 1) for (const r of list) usedIds.add(r.id)
  }

  for (const r of rows) {
    if (usedIds.has(r.id)) continue
    const e = groupingEmail(r)
    if (e) {
      const list = emailGroups.get(e) ?? []
      list.push(r)
      emailGroups.set(e, list)
    }
  }
  for (const [, list] of emailGroups) {
    if (list.length > 1) for (const r of list) usedIds.add(r.id)
  }

  // Name + vehicle is REPORT-ONLY. It's a weaker signal — never marked as
  // "would exclude". We surface it so a reviewer can spot rows like the
  // legacy "Brian Hardy / Camry" entries that share no phone but might be
  // the same person.
  for (const r of rows) {
    if (usedIds.has(r.id)) continue
    const key = `${lowerName(r)}::${(r.vehicleOfInterest ?? '').trim().toLowerCase()}`
    if (key === '::') continue
    const list = nameVehGroups.get(key) ?? []
    list.push(r)
    nameVehGroups.set(key, list)
  }

  // ── Report: phone duplicates ──────────────────────────────────────────────
  const phoneDupGroups: Group[] = [...phoneGroups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([value, rs]) => ({ key: { kind: 'phone', value }, rows: rs }))
    .sort((a, b) => b.rows.length - a.rows.length)

  console.log(`● Duplicate groups by normalized phone: ${phoneDupGroups.length}`)
  let phoneWouldExclude = 0
  for (const g of phoneDupGroups) {
    const keep = pickKeep(g.rows)
    phoneWouldExclude += g.rows.length - 1
    console.log()
    console.log(`  key:   phone ${g.key.value}`)
    console.log(`  count: ${g.rows.length}`)
    for (const r of g.rows) {
      const tag = r.id === keep.id ? '[KEEP]' : '[would-exclude]'
      console.log(
        `    ${tag.padEnd(18)} ${r.id}  ${fullName(r).padEnd(22)}` +
        `  ${(r.phone ?? r.phoneRaw).padEnd(16)}  ${(r.email ?? '').padEnd(28)}` +
        `  ${(r.vehicleOfInterest ?? '').padEnd(20)}  ${ageBucketStatus(r).padEnd(12)}` +
        `  ${fmtDate(r.createdAt)}`,
      )
    }
  }
  console.log()

  // ── Report: email duplicates (phone-side already excluded) ────────────────
  const emailDupGroups: Group[] = [...emailGroups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([value, rs]) => ({ key: { kind: 'email', value }, rows: rs }))
    .sort((a, b) => b.rows.length - a.rows.length)

  console.log(`● Duplicate groups by valid normalized email (no phone overlap): ${emailDupGroups.length}`)
  let emailWouldExclude = 0
  for (const g of emailDupGroups) {
    const keep = pickKeep(g.rows)
    emailWouldExclude += g.rows.length - 1
    console.log()
    console.log(`  key:   email ${g.key.value}`)
    console.log(`  count: ${g.rows.length}`)
    for (const r of g.rows) {
      const tag = r.id === keep.id ? '[KEEP]' : '[would-exclude]'
      console.log(
        `    ${tag.padEnd(18)} ${r.id}  ${fullName(r).padEnd(22)}` +
        `  ${(r.phone ?? r.phoneRaw).padEnd(16)}  ${(r.email ?? '').padEnd(28)}` +
        `  ${(r.vehicleOfInterest ?? '').padEnd(20)}  ${ageBucketStatus(r).padEnd(12)}` +
        `  ${fmtDate(r.createdAt)}`,
      )
    }
  }
  console.log()

  // ── Report-only: name+vehicle echoes (no recommendation) ──────────────────
  const nameVehDupGroups: Group[] = [...nameVehGroups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([value, rs]) => ({ key: { kind: 'name+vehicle', value }, rows: rs }))
    .sort((a, b) => b.rows.length - a.rows.length)

  console.log(`● Same name+vehicle but different phone/email — REPORT ONLY (no exclude rec): ${nameVehDupGroups.length}`)
  for (const g of nameVehDupGroups) {
    console.log()
    console.log(`  key:   name+vehicle "${g.key.value}"`)
    console.log(`  count: ${g.rows.length}`)
    for (const r of g.rows) {
      console.log(
        `    [report]           ${r.id}  ${fullName(r).padEnd(22)}` +
        `  ${(r.phone ?? r.phoneRaw).padEnd(16)}  ${(r.email ?? '').padEnd(28)}` +
        `  ${(r.vehicleOfInterest ?? '').padEnd(20)}  ${ageBucketStatus(r).padEnd(12)}` +
        `  ${fmtDate(r.createdAt)}`,
      )
    }
  }
  console.log()

  // ── Legacy demo seed names — separate, REPORT ONLY ────────────────────────
  const legacyRows = rows.filter((r) => LEGACY_DEMO_NAMES.has(lowerName(r)))
  console.log(`● Legacy demo seed names found: ${legacyRows.length} (REPORT ONLY — no exclude rec)`)
  for (const r of legacyRows) {
    console.log(
      `    [legacy]           ${r.id}  ${fullName(r).padEnd(22)}` +
      `  ${(r.phone ?? r.phoneRaw).padEnd(16)}  ${(r.email ?? '').padEnd(28)}` +
      `  ${(r.vehicleOfInterest ?? '').padEnd(20)}  ${ageBucketStatus(r).padEnd(12)}` +
      `  ${fmtDate(r.createdAt)}`,
    )
  }
  console.log()

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('● Audit summary')
  console.log(`  total rows                      ${rows.length}`)
  console.log(`  phone-duplicate groups          ${phoneDupGroups.length}`)
  console.log(`  email-duplicate groups          ${emailDupGroups.length}`)
  console.log(`  name+vehicle echo groups        ${nameVehDupGroups.length}  (report only)`)
  console.log(`  legacy demo seed rows           ${legacyRows.length}  (report only)`)
  console.log(`  rows an APPLY-mode would exclude ${phoneWouldExclude + emailWouldExclude}`)
  console.log(`    of which phone-side           ${phoneWouldExclude}`)
  console.log(`    of which email-side           ${emailWouldExclude}`)
  console.log()
  console.log('DRY RUN ONLY — no rows changed')
}

main()
  .catch((err) => {
    console.error('✗ Audit failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await sql.end({ timeout: 5 })
  })

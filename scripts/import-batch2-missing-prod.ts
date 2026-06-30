/**
 * One-off, file-scoped import of ONLY the Batch 2 dealers missing from
 * production dealer_prospects.
 *
 * Scope guarantee: loads outputs/utah_county_dealer_prospects_batch_2_ALL20_IMPORT.csv,
 * queries production for emails/websites/(name+city) that already exist, and
 * imports/updates ONLY the CSV rows that don't match any existing prospect by
 * any of those three keys. Existing rows (e.g. Dex Auto Group, Motiv8d Motors)
 * are never touched — no insert, no update, no cooldown/send history change —
 * because they're excluded by the dedup check before any write happens.
 *
 * Mirrors the dedup/status rules in src/lib/outreach/import.ts (dedup on
 * email OR website OR name+city; valid email + sourceUrl → "ready"; valid
 * email, no sourceUrl → "new") rather than importing that module directly —
 * it does `import 'server-only'`, which throws by design under plain Node
 * (tsx) outside a bundler that remaps the package's `browser` field, so it
 * can only ever run inside the Next.js app, not a CLI script.
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/import-batch2-missing-prod.ts
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import { db } from '../src/lib/db'
import { dealerProspects } from '../src/lib/db/schema'
import { normalizeEmail, isValidEmail } from '../src/lib/outreach/eligibility'

const CSV_PATH = 'outputs/utah_county_dealer_prospects_batch_2_ALL20_IMPORT.csv'
const ACTOR_EMAIL = 'brian@dlr-sms.com'

function clean(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length ? s : null
}

function normWebsite(w: string | null): string {
  return (w ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function keyNameCity(n: string, c: string | null): string {
  return `${n.trim().toLowerCase()}|${(c ?? '').trim().toLowerCase()}`
}

/** Same rule as src/lib/outreach/import.ts deriveStatus(). */
function deriveStatus(p: { publicEmail: string | null; sourceUrl: string | null }): string {
  if (p.publicEmail && !isValidEmail(p.publicEmail)) return 'bad_email'
  if (p.publicEmail && isValidEmail(p.publicEmail)) return p.sourceUrl ? 'ready' : 'new'
  return 'missing_contact'
}

async function main() {
  const raw = fs.readFileSync(path.resolve(CSV_PATH), 'utf8')
  const parsed = Papa.parse<Record<string, string>>(raw.trim(), { header: true, skipEmptyLines: true })
  const rows = parsed.data.filter(r => (r.dealershipName ?? '').trim())
  console.log(`CSV=${CSV_PATH}`)
  console.log(`CSV_ROWS=${rows.length}`)

  const existing = await db
    .select({
      id: dealerProspects.id,
      dealershipName: dealerProspects.dealershipName,
      city: dealerProspects.city,
      website: dealerProspects.website,
      publicEmail: dealerProspects.publicEmail,
    })
    .from(dealerProspects)

  const byEmail = new Map<string, string>()
  const byWebsite = new Map<string, string>()
  const byNameCity = new Map<string, string>()
  for (const e of existing) {
    if (e.publicEmail) byEmail.set(e.publicEmail.toLowerCase(), e.id)
    const nw = normWebsite(e.website)
    if (nw) byWebsite.set(nw, e.id)
    byNameCity.set(keyNameCity(e.dealershipName, e.city), e.id)
  }

  let created = 0, updated = 0, skippedDuplicates = 0
  const createdNames: string[] = []
  const skippedNames: string[] = []

  for (const raw of rows) {
    const dealershipName = clean(raw.dealershipName)
    if (!dealershipName) continue

    const city = clean(raw.city)
    const state = clean(raw.state)
    const website = clean(raw.website)
    const mainPhone = clean(raw.mainPhone)
    const publicEmailRaw = clean(raw.publicEmail)
    const publicEmail = publicEmailRaw ? normalizeEmail(publicEmailRaw) : null
    const sourceUrl = clean(raw.sourceUrl)
    const bestContactName = clean(raw.bestContactName)
    const bestContactTitle = clean(raw.bestContactTitle)
    const fitNotes = clean(raw.fitNotes)

    const dupId =
      (publicEmail && byEmail.get(publicEmail)) ||
      (normWebsite(website) && byWebsite.get(normWebsite(website))) ||
      byNameCity.get(keyNameCity(dealershipName, city)) ||
      null

    if (dupId) {
      // Already exists by email, website, or name+city — never touched.
      // (Expected for Dex Auto Group / Motiv8d Motors.)
      skippedDuplicates++
      skippedNames.push(`${dealershipName} <${publicEmail ?? '(no email)'}>`)
      continue
    }

    const status = deriveStatus({ publicEmail, sourceUrl })
    const insertedId = await db
      .insert(dealerProspects)
      .values({
        dealershipName, city, state, website, mainPhone,
        publicEmail, sourceUrl, bestContactName, bestContactTitle, fitNotes,
        priority: 'B',
        status,
        createdByEmail: ACTOR_EMAIL,
      })
      .returning({ id: dealerProspects.id })

    created++
    createdNames.push(`${dealershipName} <${publicEmail ?? '(no email)'}>`)

    // Track within this run so two identical CSV rows can't both insert.
    if (publicEmail) byEmail.set(publicEmail, insertedId[0]?.id ?? 'pending')
    const nw = normWebsite(website)
    if (nw) byWebsite.set(nw, insertedId[0]?.id ?? 'pending')
    byNameCity.set(keyNameCity(dealershipName, city), insertedId[0]?.id ?? 'pending')
  }

  console.log('IMPORT_SUMMARY=' + JSON.stringify({ totalRows: rows.length, created, updated, skippedDuplicates }))
  console.log('CREATED=' + JSON.stringify(createdNames))
  console.log('SKIPPED_ALREADY_EXISTED=' + JSON.stringify(skippedNames))
}

main().catch(err => {
  console.error('import-batch2-missing-prod failed:', err)
  process.exit(1)
})

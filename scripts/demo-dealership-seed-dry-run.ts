/**
 * Demo Dealership guided-demo seed planner (DRY-RUN ONLY)
 *
 * Purpose
 * -------
 * Prepare and report a safe seed plan for the Demo Dealership tenant without
 * inserting, updating, or deleting any data.
 *
 * Guarantees
 * ----------
 * - Read-only only: this script never writes to the database.
 * - Refuses any future apply/write flag until a separate reviewed implementation exists.
 * - Scopes all optional DB reads to the exact tenant name "Demo Dealership".
 * - Refuses to continue if the tenant is missing or duplicated.
 * - Prints counts / seed intent only; never prints secrets.
 * - Does not touch or import any SMS send path.
 *
 * Usage
 * -----
 *   npx tsx scripts/demo-dealership-seed-dry-run.ts
 *   npx tsx scripts/demo-dealership-seed-dry-run.ts --dry-run
 *
 * Notes
 * -----
 * - If DATABASE_URL is available (env / .env / .env.local), the script performs
 *   read-only tenant resolution and count queries.
 * - If DATABASE_URL is unavailable, the script still prints the proposed seed plan.
 */

import { config as loadDotenv } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

// Best-effort local env loading without printing values.
loadDotenv({ path: path.join(repoRoot, '.env.local') })
loadDotenv({ path: path.join(repoRoot, '.env') })

const TARGET_TENANT_NAME = 'Demo Dealership'

type IntendedStatus = 'eligible' | 'needs_review' | 'blocked'
type IntendedBucket = 'a' | 'b' | 'c' | 'd' | null

type DemoSeedRow = {
  key: string
  firstName: string
  lastName: string
  phone: string
  email: string
  vehicleName: string | null
  leadSource: string
  contactDate: string | null
  originalInquiryAt: string | null
  consentStatus: 'explicit' | 'implied' | 'unknown' | 'revoked'
  consentSource: string | null
  consentCapturedAt: string | null
  notes: string
  intendedStatus: IntendedStatus
  intendedReason: string
  intendedBucket: IntendedBucket
  shouldSelectForDraftBatch: boolean
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i++
    } else {
      args[key] = true
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const dryRun = args['dry-run'] !== false

if (args.apply || args.write || args.execute || args.live) {
  console.error('Refusing to run: this utility is DRY-RUN ONLY and has no apply mode.')
  process.exit(2)
}

const DEMO_ROWS: DemoSeedRow[] = [
  {
    key: 'ELIG-A1',
    firstName: 'Mason',
    lastName: 'Reed',
    phone: '+15550120001',
    email: 'mason.reed.demo+01@dlr-sms.test',
    vehicleName: '2024 Ford F-150 XLT',
    leadSource: 'Cars.com',
    contactDate: '2026-05-22T10:00:00Z',
    originalInquiryAt: '2026-05-22T10:00:00Z',
    consentStatus: 'explicit',
    consentSource: 'web_form',
    consentCapturedAt: '2026-05-22T10:00:00Z',
    notes: 'Demo seed candidate. Bucket A. Eligible and selected for the reviewable draft batch.',
    intendedStatus: 'eligible',
    intendedReason: 'Valid phone, explicit consent, parseable 14–29 day contact date.',
    intendedBucket: 'a',
    shouldSelectForDraftBatch: true,
  },
  {
    key: 'ELIG-A2',
    firstName: 'Ava',
    lastName: 'Cole',
    phone: '+15550120002',
    email: 'ava.cole.demo+02@dlr-sms.test',
    vehicleName: '2024 Honda CR-V EX',
    leadSource: 'Dealer Website',
    contactDate: '2026-05-18T15:30:00Z',
    originalInquiryAt: '2026-05-18T15:30:00Z',
    consentStatus: 'explicit',
    consentSource: 'web_form',
    consentCapturedAt: '2026-05-18T15:30:00Z',
    notes: 'Demo seed candidate. Bucket A. Good happy-path lead.',
    intendedStatus: 'eligible',
    intendedReason: 'Valid phone, explicit consent, parseable 14–29 day contact date.',
    intendedBucket: 'a',
    shouldSelectForDraftBatch: true,
  },
  {
    key: 'ELIG-B1',
    firstName: 'Liam',
    lastName: 'Parker',
    phone: '+15550120003',
    email: 'liam.parker.demo+03@dlr-sms.test',
    vehicleName: '2023 Toyota Camry SE',
    leadSource: 'AutoTrader',
    contactDate: '2026-05-01T09:00:00Z',
    originalInquiryAt: '2026-05-01T09:00:00Z',
    consentStatus: 'implied',
    consentSource: 'phone_inquiry',
    consentCapturedAt: '2026-05-01T09:00:00Z',
    notes: 'Demo seed candidate. Bucket B. Eligible with implied consent.',
    intendedStatus: 'eligible',
    intendedReason: 'Valid phone, implied consent, parseable 30–59 day contact date.',
    intendedBucket: 'b',
    shouldSelectForDraftBatch: true,
  },
  {
    key: 'ELIG-B2',
    firstName: 'Emma',
    lastName: 'Hayes',
    phone: '+15550120004',
    email: 'emma.hayes.demo+04@dlr-sms.test',
    vehicleName: '2024 Chevrolet Silverado 1500',
    leadSource: 'TrueCar',
    contactDate: '2026-04-28T13:45:00Z',
    originalInquiryAt: '2026-04-28T13:45:00Z',
    consentStatus: 'explicit',
    consentSource: 'web_form',
    consentCapturedAt: '2026-04-28T13:45:00Z',
    notes: 'Demo seed candidate. Bucket B. Eligible and batchable.',
    intendedStatus: 'eligible',
    intendedReason: 'Valid phone, explicit consent, parseable 30–59 day contact date.',
    intendedBucket: 'b',
    shouldSelectForDraftBatch: true,
  },
  {
    key: 'ELIG-C1',
    firstName: 'Noah',
    lastName: 'Bryant',
    phone: '+15550120005',
    email: 'noah.bryant.demo+05@dlr-sms.test',
    vehicleName: '2023 Jeep Grand Cherokee',
    leadSource: 'Facebook Lead Ad',
    contactDate: '2026-04-03T12:15:00Z',
    originalInquiryAt: '2026-04-03T12:15:00Z',
    consentStatus: 'explicit',
    consentSource: 'web_form',
    consentCapturedAt: '2026-04-03T12:15:00Z',
    notes: 'Demo seed candidate. Bucket C. Eligible older lead.',
    intendedStatus: 'eligible',
    intendedReason: 'Valid phone, explicit consent, parseable 60–89 day contact date.',
    intendedBucket: 'c',
    shouldSelectForDraftBatch: true,
  },
  {
    key: 'ELIG-C2',
    firstName: 'Olivia',
    lastName: 'Ward',
    phone: '+15550120006',
    email: 'olivia.ward.demo+06@dlr-sms.test',
    vehicleName: '2024 Hyundai Tucson SEL',
    leadSource: 'KSL',
    contactDate: '2026-03-28T17:20:00Z',
    originalInquiryAt: '2026-03-28T17:20:00Z',
    consentStatus: 'implied',
    consentSource: 'phone_inquiry',
    consentCapturedAt: '2026-03-28T17:20:00Z',
    notes: 'Demo seed candidate. Bucket C. Eligible older lead.',
    intendedStatus: 'eligible',
    intendedReason: 'Valid phone, implied consent, parseable 60–89 day contact date.',
    intendedBucket: 'c',
    shouldSelectForDraftBatch: false,
  },
  {
    key: 'ELIG-D1',
    firstName: 'Ethan',
    lastName: 'Price',
    phone: '+15550120007',
    email: 'ethan.price.demo+07@dlr-sms.test',
    vehicleName: '2022 Nissan Rogue SV',
    leadSource: 'Dealer Website',
    contactDate: '2026-02-14T08:05:00Z',
    originalInquiryAt: '2026-02-14T08:05:00Z',
    consentStatus: 'explicit',
    consentSource: 'web_form',
    consentCapturedAt: '2026-02-14T08:05:00Z',
    notes: 'Demo seed candidate. Bucket D. Eligible long-stale lead.',
    intendedStatus: 'eligible',
    intendedReason: 'Valid phone, explicit consent, parseable 90+ day contact date.',
    intendedBucket: 'd',
    shouldSelectForDraftBatch: false,
  },
  {
    key: 'ELIG-D2',
    firstName: 'Sophia',
    lastName: 'Bell',
    phone: '+15550120008',
    email: 'sophia.bell.demo+08@dlr-sms.test',
    vehicleName: '2021 Subaru Outback Premium',
    leadSource: 'Cars.com',
    contactDate: '2026-01-30T11:40:00Z',
    originalInquiryAt: '2026-01-30T11:40:00Z',
    consentStatus: 'explicit',
    consentSource: 'web_form',
    consentCapturedAt: '2026-01-30T11:40:00Z',
    notes: 'Demo seed candidate. Bucket D. Eligible long-stale lead.',
    intendedStatus: 'eligible',
    intendedReason: 'Valid phone, explicit consent, parseable 90+ day contact date.',
    intendedBucket: 'd',
    shouldSelectForDraftBatch: false,
  },
  {
    key: 'REVIEW-1',
    firstName: 'Caleb',
    lastName: 'Morris',
    phone: '+15550120009',
    email: 'caleb.morris.demo+09@dlr-sms.test',
    vehicleName: '2024 Kia Telluride EX',
    leadSource: 'Dealer Website',
    contactDate: null,
    originalInquiryAt: null,
    consentStatus: 'explicit',
    consentSource: 'web_form',
    consentCapturedAt: '2026-05-20T09:10:00Z',
    notes: 'Demo seed candidate. Intentionally missing date so import should land in needs_review.',
    intendedStatus: 'needs_review',
    intendedReason: 'Missing contact date should require review before bucket assignment.',
    intendedBucket: null,
    shouldSelectForDraftBatch: false,
  },
  {
    key: 'REVIEW-2',
    firstName: 'Harper',
    lastName: 'Ross',
    phone: '+15550120010',
    email: 'harper.ross.demo+10@dlr-sms.test',
    vehicleName: '2024 Mazda CX-50',
    leadSource: 'Chat',
    contactDate: 'not-a-date',
    originalInquiryAt: null,
    consentStatus: 'implied',
    consentSource: 'chat',
    consentCapturedAt: '2026-05-12T14:25:00Z',
    notes: 'Demo seed candidate. Intentionally unparseable date so import should land in needs_review.',
    intendedStatus: 'needs_review',
    intendedReason: 'Unparseable contact date should require review before bucket assignment.',
    intendedBucket: null,
    shouldSelectForDraftBatch: false,
  },
  {
    key: 'BLOCK-1',
    firstName: 'Logan',
    lastName: 'Stone',
    phone: '555-INVALID',
    email: 'logan.stone.demo+11@dlr-sms.test',
    vehicleName: '2023 GMC Sierra 1500',
    leadSource: 'Cars.com',
    contactDate: '2026-04-15T16:00:00Z',
    originalInquiryAt: '2026-04-15T16:00:00Z',
    consentStatus: 'explicit',
    consentSource: 'web_form',
    consentCapturedAt: '2026-04-15T16:00:00Z',
    notes: 'Demo seed candidate. Intentionally invalid phone to create one blocked safety example.',
    intendedStatus: 'blocked',
    intendedReason: 'Invalid phone should block import validation.',
    intendedBucket: null,
    shouldSelectForDraftBatch: false,
  },
  {
    key: 'BLOCK-2',
    firstName: 'Grace',
    lastName: 'Turner',
    phone: '+15550120012',
    email: 'grace.turner.demo+12@dlr-sms.test',
    vehicleName: '2024 Volkswagen Atlas',
    leadSource: 'AutoTrader',
    contactDate: '2026-04-08T10:50:00Z',
    originalInquiryAt: '2026-04-08T10:50:00Z',
    consentStatus: 'revoked',
    consentSource: 'manual',
    consentCapturedAt: '2026-04-08T10:50:00Z',
    notes: 'Demo seed candidate. Intentionally revoked consent to create one blocked compliance example.',
    intendedStatus: 'blocked',
    intendedReason: 'Revoked consent should hard-block import validation.',
    intendedBucket: null,
    shouldSelectForDraftBatch: false,
  },
]

function summarizePlan(rows: DemoSeedRow[]) {
  const counts = {
    total: rows.length,
    eligible: rows.filter(r => r.intendedStatus === 'eligible').length,
    needsReview: rows.filter(r => r.intendedStatus === 'needs_review').length,
    blocked: rows.filter(r => r.intendedStatus === 'blocked').length,
    selectedForDraftBatch: rows.filter(r => r.shouldSelectForDraftBatch).length,
  }

  const buckets = {
    a: rows.filter(r => r.intendedBucket === 'a').length,
    b: rows.filter(r => r.intendedBucket === 'b').length,
    c: rows.filter(r => r.intendedBucket === 'c').length,
    d: rows.filter(r => r.intendedBucket === 'd').length,
  }

  return { counts, buckets }
}

function printPlan(rows: DemoSeedRow[]) {
  const { counts, buckets } = summarizePlan(rows)

  console.log('')
  console.log(`Target tenant      : ${TARGET_TENANT_NAME}`)
  console.log(`Mode               : ${dryRun ? 'DRY RUN ONLY' : 'UNREACHABLE'}`)
  console.log(`DATABASE_URL       : ${process.env.DATABASE_URL ? 'available' : 'unavailable'}`)
  console.log('Writes             : disabled (no insert/update/delete path exists in this file)')
  console.log('SMS                : untouched (no send/import execution path invoked)')
  console.log('')
  console.log('Proposed guided-demo import mix:')
  console.log(`  total rows                 : ${counts.total}`)
  console.log(`  intended eligible          : ${counts.eligible}`)
  console.log(`  intended needs_review      : ${counts.needsReview}`)
  console.log(`  intended blocked           : ${counts.blocked}`)
  console.log(`  intended selected later    : ${counts.selectedForDraftBatch}`)
  console.log(`  intended buckets           : A=${buckets.a} B=${buckets.b} C=${buckets.c} D=${buckets.d}`)
  console.log('')
  console.log('Seed plan rows:')
  for (const row of rows) {
    const bucket = row.intendedBucket ? ` bucket=${row.intendedBucket}` : ''
    const select = row.shouldSelectForDraftBatch ? ' select=yes' : ''
    console.log(
      `  ${row.key.padEnd(8)} ${row.intendedStatus.padEnd(12)} ` +
      `${row.firstName} ${row.lastName}  phone=${row.phone} consent=${row.consentStatus}${bucket}${select}`,
    )
  }

  console.log('')
  console.log('Planned later draft-batch subset (review only, not created by this script):')
  for (const row of rows.filter(r => r.shouldSelectForDraftBatch)) {
    console.log(`  - ${row.key} ${row.firstName} ${row.lastName} (${row.intendedBucket ?? 'n/a'})`)
  }
}

type DbReadSummary = {
  tenantId: string
  counts: Record<string, number>
}

async function maybeReadDemoTenantCounts(): Promise<DbReadSummary | null> {
  if (!process.env.DATABASE_URL) return null

  const [{ eq, sql }, { db }, schema] = await Promise.all([
    import('drizzle-orm'),
    import('../src/lib/db'),
    import('../src/lib/db/schema'),
  ])

  const {
    tenants,
    users,
    leads,
    pilotLeadImports,
    pilotBatches,
    pilotBatchLeads,
    conversations,
    messages,
  } = schema

  const tenantRows = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.name, TARGET_TENANT_NAME))

  if (tenantRows.length === 0) {
    console.log('')
    console.log(`Tenant lookup      : exact name not found (${TARGET_TENANT_NAME})`)
    console.log('DB reads           : skipped after safe missing-tenant exit')
    return null
  }

  if (tenantRows.length > 1) {
    console.log('')
    console.log(`Tenant lookup      : refused (${tenantRows.length} tenants matched exact name)`)
    console.log('DB reads           : skipped after duplicate-tenant safety check')
    return null
  }

  const tenant = tenantRows[0]

  const userCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.tenantId, tenant.id))

  const leadCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.tenantId, tenant.id))

  const importCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pilotLeadImports)
    .where(eq(pilotLeadImports.tenantId, tenant.id))

  const batchCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pilotBatches)
    .where(eq(pilotBatches.tenantId, tenant.id))

  const batchLeadCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pilotBatchLeads)
    .innerJoin(pilotBatches, eq(pilotBatchLeads.batchId, pilotBatches.id))
    .where(eq(pilotBatches.tenantId, tenant.id))

  const conversationCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(eq(conversations.tenantId, tenant.id))

  const messageCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.tenantId, tenant.id))

  return {
    tenantId: tenant.id,
    counts: {
      users: userCountRow[0]?.count ?? 0,
      leads: leadCountRow[0]?.count ?? 0,
      pilotLeadImports: importCountRow[0]?.count ?? 0,
      pilotBatches: batchCountRow[0]?.count ?? 0,
      pilotBatchLeads: batchLeadCountRow[0]?.count ?? 0,
      conversations: conversationCountRow[0]?.count ?? 0,
      messages: messageCountRow[0]?.count ?? 0,
    },
  }
}

async function main() {
  console.log('Demo Dealership seed planner — DRY RUN ONLY')
  console.log('=============================================')

  printPlan(DEMO_ROWS)

  try {
    const dbSummary = await maybeReadDemoTenantCounts()

    if (dbSummary) {
      console.log('')
      console.log('Current Demo tenant counts (read-only):')
      console.log(`  tenantId                 : ${dbSummary.tenantId}`)
      for (const [key, value] of Object.entries(dbSummary.counts)) {
        console.log(`  ${key.padEnd(24)}: ${value}`)
      }
    } else if (!process.env.DATABASE_URL) {
      console.log('')
      console.log('Current Demo tenant counts : skipped (DATABASE_URL unavailable)')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log('')
    console.log(`DB read status       : skipped due to safe read error (${message})`)
  }

  console.log('')
  console.log('What this script would do later if a reviewed apply mode is added:')
  console.log('  1. Resolve exact tenant "Demo Dealership" only')
  console.log('  2. Report current tenant-scoped counts')
  console.log('  3. Prepare 12 pilot-import rows for review')
  console.log('  4. Target 8 eligible, 2 needs_review, 2 blocked')
  console.log('  5. Recommend 5 selected leads for one previewable draft batch later')
  console.log('  6. Never enable SMS or call any send path')
  console.log('')
  console.log('Review command:')
  console.log('  npx tsx scripts/demo-dealership-seed-dry-run.ts --dry-run')
}

main().catch((err) => {
  console.error('demo-dealership-seed-dry-run failed:', err)
  process.exit(1)
})

/**
 * Seed/cleanup helper for test dealer-intake rows.
 *
 * Creates rows in dealer_intakes with a prefixed token so cleanup is one
 * SQL line (`WHERE token LIKE 'smoke-%'`). Reuses the same DB connection
 * the rest of the app uses — pass DATABASE_URL pointed at whichever env
 * you want to seed (local dev, staging, or prod).
 *
 * USAGE
 * -----
 *   # Create an empty smoke-test intake (token = smoke-<16hex>)
 *   tsx scripts/seed-test-intake.ts --kind smoke
 *
 *   # Create a demo intake with a friendly name
 *   tsx scripts/seed-test-intake.ts --kind demo --name "Smith Honda demo"
 *
 *   # Create a fully-populated intake so the admin 10DLC step is in `pending`
 *   # (skips Stage 1 entry — useful when iterating on the operator UI)
 *   tsx scripts/seed-test-intake.ts --kind smoke --populate
 *
 *   # Real-dealer-style token (no prefix, matches generateIntakeLink output)
 *   tsx scripts/seed-test-intake.ts --kind real --name "Capital Toyota"
 *
 *   # Delete every smoke-test row in this DB (token LIKE 'smoke-%')
 *   tsx scripts/seed-test-intake.ts --cleanup --kind smoke --yes
 *
 * The --base-url flag overrides the printed URLs. Defaults to NEXT_PUBLIC_APP_URL
 * if set, then https://dlr-sms.com.
 */

import 'dotenv/config'
import { randomBytes } from 'crypto'
import { eq, like } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { dealerIntakes } from '../src/lib/db/schema'

type Kind = 'smoke' | 'demo' | 'real'

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
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

function makeToken(kind: Kind): string {
  if (kind === 'real') return randomBytes(20).toString('hex')          // 40 hex, matches admin UI
  return `${kind}-${randomBytes(8).toString('hex')}`                   // smoke-<16hex> or demo-<16hex>
}

function timestampSuffix(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`
}

// Pre-populated values that put a fresh intake into the state the admin
// console expects when testing the 10DLC submission flow: Stage 1 complete,
// submittedAt set, launchStatus=submitted, but 10DLC not yet submitted.
const POPULATE_FIELDS = {
  businessLegalName:     'Test Automotive Group LLC',
  ein:                   '00-0000000',
  businessWebsite:       'https://example-dealer.test',
  businessAddress:       '123 Test St, Salt Lake City, UT 84101',
  primaryContactName:    'Test Contact',
  primaryContactEmail:   'test-contact@example-dealer.test',
  primaryContactPhone:   '+18015550100',
  alertEmail:            'alerts@example-dealer.test',
  alertPhone:            '+18015550101',
  storePhone:            '+18015550102',
  timezone:              'America/Denver',
  businessHours:         'Mon–Sat 9a–7p',
  expectedMonthlyVolume: 200,
  crmSystem:             'VinSolutions',
  leadSourceExplanation: 'Stale leads from VinSolutions CRM — never replied to first quote follow-up. ' +
                         'All originated from dealership-owned web forms; all have prior opt-in via dealership ToS.',
  consentExplanation:    'Consent collected at lead submission via dealership website form; ' +
                         'each lead agreed to text/email follow-up about their vehicle inquiry.',
} as const

async function seed(kind: Kind, name: string | undefined, populate: boolean, baseUrl: string) {
  const dealershipName = name ?? `${kind.toUpperCase()} ${timestampSuffix()}`
  const token = makeToken(kind)

  const values: typeof dealerIntakes.$inferInsert = {
    token,
    dealershipName,
    launchStatus: 'submitted',
    ...(populate ? { ...POPULATE_FIELDS, submittedAt: new Date() } : {}),
  }

  const [row] = await db.insert(dealerIntakes).values(values).returning({ id: dealerIntakes.id })

  console.log(`✅ Created intake (kind=${kind}, populate=${populate})`)
  console.log(`   intake id:  ${row.id}`)
  console.log(`   token:      ${token}`)
  console.log(`   name:       ${dealershipName}`)
  console.log(`   dealer URL: ${baseUrl}/intake/${token}`)
  console.log(`   admin URL:  ${baseUrl}/admin/dlr/intakes/${row.id}`)
}

async function cleanup(kind: Kind, confirmed: boolean) {
  if (kind === 'real') {
    console.error('Refusing to bulk-delete `real`-kind intakes — there is no prefix to scope by.')
    process.exit(2)
  }
  if (!confirmed) {
    console.error(`Add --yes to confirm. Would have deleted: dealer_intakes WHERE token LIKE '${kind}-%'`)
    process.exit(2)
  }
  const deleted = await db.delete(dealerIntakes).where(like(dealerIntakes.token, `${kind}-%`)).returning({ id: dealerIntakes.id })
  console.log(`✅ Deleted ${deleted.length} test intake(s) (token LIKE '${kind}-%').`)
  if (deleted.length > 0) {
    console.log('   (Provisioned tenants are NOT deleted — see CLAUDE.md / repo notes for tenant cleanup if needed.)')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const kind = (args.kind as Kind | undefined) ?? 'smoke'
  if (!['smoke', 'demo', 'real'].includes(kind)) {
    console.error(`--kind must be one of: smoke, demo, real (got: ${kind})`)
    process.exit(2)
  }
  const baseUrl = (args['base-url'] as string | undefined)
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? 'https://dlr-sms.com'

  if (args.cleanup) {
    await cleanup(kind, Boolean(args.yes))
  } else {
    await seed(kind, args.name as string | undefined, Boolean(args.populate), baseUrl)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('seed-test-intake failed:', err)
  process.exit(1)
})

// Silence the unused-import warning when the file is parsed without running.
void eq

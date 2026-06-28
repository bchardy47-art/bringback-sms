import 'dotenv/config'
import { eq, ilike, or } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { dealerProspects } from '../src/lib/db/schema'
import { sendTestToBrian } from '../src/lib/outreach/send'

const TEMPLATE_KEY = 'dlr_pilot_invite_v1_red_revival'
const TEST_RECIPIENT = 'brian@dlr-sms.com'
const ACTOR = { id: 'script:send-outreach-test-to-brian', email: TEST_RECIPIENT }
const REQUIRED_CONFIRM = 'SEND_TEST_TO_BRIAN'

type Prospect = typeof dealerProspects.$inferSelect

function looksSafeForTest(p: Prospect): boolean {
  const fields = [
    p.dealershipName,
    p.publicEmail,
    p.bestContactName,
    p.bestContactTitle,
    p.sourceNotes,
    p.fitNotes,
    p.createdByEmail,
  ].filter(Boolean).join(' ').toLowerCase()

  return (
    (p.publicEmail ?? '').trim().toLowerCase() === TEST_RECIPIENT ||
    fields.includes('brian') ||
    fields.includes('test') ||
    fields.includes('demo') ||
    fields.includes('sample') ||
    fields.includes('fake')
  )
}

function printHeader(mode: string) {
  console.log(`mode=${mode}`)
  console.log(`templateKey=${TEMPLATE_KEY}`)
  console.log(`testRecipient=${TEST_RECIPIENT}`)
}

function printProspect(p: Prospect) {
  console.log(`prospectId=${p.id}`)
  console.log(`dealer=${p.dealershipName}`)
  console.log(`publicEmail=${p.publicEmail ?? '(none)'}`)
}

async function resolveProspect(): Promise<Prospect | null> {
  const explicitId = (process.env.OUTREACH_TEST_PROSPECT_ID ?? '').trim()
  if (explicitId) {
    const rows = await db.select().from(dealerProspects).where(eq(dealerProspects.id, explicitId)).limit(1)
    const prospect = rows[0] ?? null
    if (!prospect) {
      console.error(`No prospect found for OUTREACH_TEST_PROSPECT_ID=${explicitId}`)
      return null
    }
    if (!looksSafeForTest(prospect)) {
      console.error('Refusing: OUTREACH_TEST_PROSPECT_ID does not look like a Brian/test prospect.')
      printProspect(prospect)
      return null
    }
    return prospect
  }

  const brianRows = await db
    .select()
    .from(dealerProspects)
    .where(eq(dealerProspects.publicEmail, TEST_RECIPIENT))
    .limit(2)

  if (brianRows.length === 1) return brianRows[0]
  if (brianRows.length > 1) {
    console.error('Multiple Brian prospects found. Set OUTREACH_TEST_PROSPECT_ID to one safe prospect id.')
    brianRows.forEach(printProspect)
    return null
  }

  const testCandidates = await db
    .select()
    .from(dealerProspects)
    .where(or(
      ilike(dealerProspects.dealershipName, '%test%'),
      ilike(dealerProspects.dealershipName, '%demo%'),
      ilike(dealerProspects.dealershipName, '%sample%'),
      ilike(dealerProspects.dealershipName, '%fake%'),
      ilike(dealerProspects.dealershipName, '%brian%'),
      ilike(dealerProspects.publicEmail, '%test%'),
      ilike(dealerProspects.publicEmail, '%demo%'),
      ilike(dealerProspects.publicEmail, '%brian%'),
      ilike(dealerProspects.bestContactName, '%brian%'),
      ilike(dealerProspects.fitNotes, '%test%'),
      ilike(dealerProspects.fitNotes, '%demo%'),
      ilike(dealerProspects.fitNotes, '%sample%'),
      ilike(dealerProspects.fitNotes, '%fake%'),
    ))
    .limit(10)

  const safeCandidates = testCandidates.filter(looksSafeForTest)
  if (safeCandidates.length === 1) return safeCandidates[0]

  if (safeCandidates.length > 1) {
    console.error('Multiple safe test prospects found. Set OUTREACH_TEST_PROSPECT_ID to one of these ids:')
    safeCandidates.forEach(printProspect)
    return null
  }

  console.error('No Brian/test prospect found.')
  console.error('Create or identify one safe Brian/test prospect, then re-run with OUTREACH_TEST_PROSPECT_ID=<prospect-id>.')
  return null
}

async function main() {
  const confirmed = process.env.CONFIRM_SEND_TEST_TO_BRIAN === REQUIRED_CONFIRM
  printHeader(confirmed ? 'SEND_TEST_TO_BRIAN' : 'CONFIRMATION_REQUIRED')

  const prospect = await resolveProspect()
  if (!prospect) process.exit(1)

  printProspect(prospect)

  if (!confirmed) {
    console.log('No email sent.')
    console.log(`Run: CONFIRM_SEND_TEST_TO_BRIAN=${REQUIRED_CONFIRM} npx tsx scripts/send-outreach-test-to-brian.ts`)
    process.exit(1)
  }

  const outcome = await sendTestToBrian(prospect.id, TEMPLATE_KEY, ACTOR)
  console.log('outcome=' + JSON.stringify(outcome))
  process.exit(outcome.ok ? 0 : 1)
}

main().catch((err) => {
  console.error('send-outreach-test-to-brian failed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})

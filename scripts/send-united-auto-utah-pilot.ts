/**
 * First live DLR dealer-outreach send — United Auto Utah.
 *
 * Sends the "DLR Pilot Invite v1 - Red Revival" template to ONE test prospect
 * (unitedautoutah@gmail.com) through the normal, fully-guarded outreach path:
 *
 *   • seeds default templates (so the Red Revival template exists in the console)
 *   • upserts the United Auto Utah prospect with the fields eligibility requires
 *     (dealership name, public email, source URL, status=ready)
 *   • calls sendMonthlyInvite() — the SAME orchestrator the Outreach Console uses
 *
 * Safety: real delivery happens ONLY when OUTREACH_SEND_ENABLED=true. Otherwise
 * the send is logged to the Sent Log as `dry_run` and nothing leaves the building.
 * Every attempt (sent | dry_run | skipped | failed) is recorded in outreach_sends.
 *
 * Usage:
 *   npx tsx scripts/send-united-auto-utah-pilot.ts
 *
 * Add --send to require that real sending is armed (the script will refuse to run
 * if OUTREACH_SEND_ENABLED is not exactly "true"):
 *   npx tsx scripts/send-united-auto-utah-pilot.ts --send
 */

import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { dealerProspects } from '../src/lib/db/schema'
import { ensureDefaultTemplates, hasBusinessAddress, businessAddress } from '../src/lib/outreach/templates'
import { sendMonthlyInvite } from '../src/lib/outreach/send'
import { sendEnabled } from '../src/lib/outreach/eligibility'

const TEMPLATE_KEY = 'dlr_pilot_invite_v1_red_revival'
const DEFAULT_RECIPIENT = 'unitedautoutah@gmail.com'
const DEALERSHIP = 'United Auto Utah'
// Safe script actor — does NOT import src/lib/admin/access (server-only auth).
// sendMonthlyInvite records the activity event with role "admin".
const SCRIPT_ACTOR = { id: 'script:united-auto-utah-pilot', email: 'brian@dlr-sms.com' }
// A public source URL is required before a prospect is contactable. Update this
// to the dealership's real listing/website once confirmed.
const SOURCE_URL = 'https://www.google.com/search?q=United+Auto+Utah'

async function main() {
  const args = process.argv.slice(2)
  const requireArmed = args.includes('--send')

  // --to <addr> overrides the recipient (default unitedautoutah@gmail.com).
  // The override flows through the prospect row, the email, and the send log.
  const toIdx = args.indexOf('--to')
  const toOverride =
    toIdx >= 0 && args[toIdx + 1] && !args[toIdx + 1].startsWith('--')
      ? args[toIdx + 1]
      : undefined
  const recipient = toOverride ?? DEFAULT_RECIPIENT
  if (toOverride) console.log(`TEST RECIPIENT OVERRIDE -> ${recipient}\n`)
  if (requireArmed && !sendEnabled()) {
    console.error('Refusing: --send passed but OUTREACH_SEND_ENABLED is not "true".')
    process.exit(1)
  }
  // Compliance fail-safe: a live send with no postal address would ship a blank
  // footer. Refuse the armed send early (the orchestrator also blocks it).
  if (requireArmed && !hasBusinessAddress()) {
    console.error('Refusing: --send passed but OUTREACH_BUSINESS_ADDRESS is not set (CAN-SPAM postal address required).')
    process.exit(1)
  }
  if (!hasBusinessAddress()) {
    console.warn('⚠️  OUTREACH_BUSINESS_ADDRESS is not set — the footer address will render blank.')
    console.warn('   Set it before any live send. Continuing dry run.\n')
  } else {
    console.log(`Footer address: ${businessAddress()}\n`)
  }

  // 1. Make sure the Red Revival template is seeded into outreach_templates.
  await ensureDefaultTemplates()

  // 2. Upsert the United Auto Utah prospect by email (idempotent).
  const existing = await db
    .select()
    .from(dealerProspects)
    .where(eq(dealerProspects.publicEmail, recipient))
    .limit(1)

  let prospectId: string
  if (existing[0]) {
    prospectId = existing[0].id
    // Re-arm an existing row so it's eligible (status sendable, source present),
    // without clobbering an active cooldown.
    await db
      .update(dealerProspects)
      .set({
        dealershipName: DEALERSHIP,
        sourceUrl: existing[0].sourceUrl ?? SOURCE_URL,
        status: ['new', 'ready', 'sent_intro', 'follow_up'].includes(existing[0].status)
          ? existing[0].status
          : 'ready',
        updatedAt: new Date(),
      })
      .where(eq(dealerProspects.id, prospectId))
    console.log(`Found existing prospect ${prospectId} (${DEALERSHIP}).`)
  } else {
    const [inserted] = await db
      .insert(dealerProspects)
      .values({
        dealershipName: DEALERSHIP,
        state: 'UT',
        publicEmail: recipient,
        sourceUrl: SOURCE_URL,
        status: 'ready',
        priority: 'A',
        createdByEmail: SCRIPT_ACTOR.email,
        fitNotes: 'First live DLR pilot outreach test prospect.',
      })
      .returning({ id: dealerProspects.id })
    prospectId = inserted.id
    console.log(`Created prospect ${prospectId} (${DEALERSHIP}).`)
  }

  // 3. Send via the guarded orchestrator (test prospect only).
  console.log(`\nOUTREACH_SEND_ENABLED=${process.env.OUTREACH_SEND_ENABLED ?? '(unset)'} → ` +
    `${sendEnabled() ? 'REAL SEND armed' : 'DRY RUN (no email leaves the building)'}`)
  console.log(`Template: ${TEMPLATE_KEY}`)
  console.log(`To:       ${recipient}\n`)

  const outcome = await sendMonthlyInvite(prospectId, TEMPLATE_KEY, SCRIPT_ACTOR)

  console.log('Outcome:', JSON.stringify(outcome, null, 2))
  if (outcome.ok && outcome.kind === 'sent') {
    console.log('\n✅ Email sent. Logged in Sent Log as status=sent.')
  } else if (!outcome.ok && outcome.kind === 'dry_run') {
    console.log('\n🟡 Dry run. Logged in Sent Log as status=dry_run. No email sent.')
    console.log('   Set OUTREACH_SEND_ENABLED=true to send for real.')
  } else if (!outcome.ok && outcome.kind === 'skipped') {
    console.log(`\n⏭️  Skipped (${outcome.reason}). Logged in Sent Log as status=skipped.`)
  } else {
    console.log(`\n❌ Failed (${'reason' in outcome ? outcome.reason : 'unknown'}). See Sent Log.`)
  }

  process.exit(outcome.ok || outcome.kind === 'dry_run' ? 0 : 1)
}

main().catch(err => {
  console.error('send-united-auto-utah-pilot failed:', err)
  process.exit(1)
})

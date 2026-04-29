/**
 * Set Tenant Production Fields
 *
 * Populates the Demo Dealership tenant record with the fields needed
 * to clear 10DLC/TCR submission readiness blockers in the Go/No-Go report.
 *
 * EDIT THE VALUES BELOW before running — replace every placeholder with
 * your real dealership information.
 *
 * Safe to re-run: uses db.update() which overwrites the current values.
 *
 * Does NOT touch: leads, enrollments, workflows, messages, pilot batches,
 * smsSendingNumber, messagingProfileId, isLive, complianceBlocked, or
 * any environment variable (including SMS_LIVE_MODE).
 *
 * Usage:
 *   # Preview what would be written (no DB changes):
 *   DATABASE_URL=postgresql://brianhardy@localhost:5432/dlr npx tsx scripts/set-tenant-production-fields.ts --dry-run
 *
 *   # Apply for real:
 *   DATABASE_URL=postgresql://brianhardy@localhost:5432/dlr npx tsx scripts/set-tenant-production-fields.ts
 *
 * After running, verify at:
 *   /admin/dlr/production  — 10DLC Submission Readiness section
 *   /admin/dlr/go-no-go    — blocker count should drop to Telnyx-only items
 *   /admin/dlr/pilot-pack  — tenant fields in the export pack
 */

import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { tenants } from '../src/lib/db/schema'

// ─── EDIT THESE VALUES ────────────────────────────────────────────────────────
// Replace every placeholder with real information before running.

const FIELDS = {
  // ── Business identity (TCR brand registration) ────────────────────────────
  // Must match your IRS/EIN registration exactly.
  businessLegalName: 'BCHardy LLC',
  ein:               '82-3785349',

  // Full registered business address (street, city, state, ZIP)
  businessAddress:   '1346 West Fort Rock Drive, Saratoga Springs, UT 84045',

  // ── Web presence ─────────────────────────────────────────────────────────
  // All URLs must be publicly accessible. TCR will check them.
  businessWebsite:   'https://dlr-sms.com',
  privacyPolicyUrl:  'https://dlr-sms.com/privacy',
  termsUrl:          'https://dlr-sms.com/terms',

  // Can be the same as termsUrl if that page includes SMS consent language.
  smsTermsUrl:       'https://dlr-sms.com/sms-terms',

  // ── 10DLC campaign details ────────────────────────────────────────────────
  // See: https://help.telnyx.com/en/articles/6443088-10dlc-use-cases
  // For a dealership sending revival/follow-up messages: MIXED or MARKETING
  brandUseCase:      'MIXED',

  // Plain-language description of your campaign (submitted to TCR).
  campaignUseCase:   'Automated follow-up messages to leads who previously inquired about vehicle purchases but have not responded. Messages re-engage customers with relevant vehicle options and invite them to reply or opt out.',

  // Describes how customer SMS consent is collected.
  // Using conservative Version 2 wording (prior-inquiry / established relationship).
  // Switch to Version 1 (explicit opt-in) only when all pilot leads come from a confirmed
  // SMS opt-in form and you can provide proof to TCR on request.
  consentExplanation: 'Customers initiated contact with the dealership by submitting a vehicle inquiry or contacting the dealership directly to express interest in purchasing a vehicle. Messages are sent only to individuals with an established prior business relationship with the dealership based on that inquiry. Every message includes opt-out instructions (reply STOP), and opt-outs are honored immediately and permanently. This program does not contact cold or purchased lists.',

  // ── 10DLC registration status ─────────────────────────────────────────────
  // Leave as 'not_started' until you actually submit in Telnyx portal.
  // Once Telnyx approves, update to 'approved'.
  tenDlcStatus: 'not_started' as const,
}

// ── Sample messages ────────────────────────────────────────────────────────────
// TCR requires at least 2 representative sample messages per campaign.
// These are stored on the tenant record. You can also save them via the
// Sample Message Library on /admin/dlr/production.
//
// The messages below are taken from the 14-Day Stale Lead Revival workflow.
// They already include opt-out language and dealership identity.
const SAMPLE_MESSAGES = [
  "Hi [FirstName], this is [DealershipName]. We noticed you were recently looking for a vehicle. Still interested? Reply STOP to opt out.",
  "Hi [FirstName], just following up from [DealershipName]. We have some great options available this week. Want to come in for a test drive? Reply STOP to opt out.",
]

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  console.log(`\n📋 ${isDryRun ? '[DRY RUN] ' : ''}Setting tenant production fields for "Demo Dealership"...\n`)
  if (isDryRun) {
    console.log('   ⚠️  DRY RUN — no changes will be written to the database.\n')
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.name, 'Demo Dealership'),
  })

  if (!tenant) {
    console.error('❌ Tenant "Demo Dealership" not found.')
    process.exit(1)
  }

  console.log(`Found tenant: ${tenant.name} (${tenant.id})\n`)

  // Check for placeholders
  const placeholders = Object.entries(FIELDS).filter(([, v]) =>
    typeof v === 'string' && (v.includes('YOUR') || v.includes('XX-') || v.includes('yourdealership') || v.includes('123 Main'))
  )

  if (placeholders.length > 0) {
    console.warn('⚠️  The following fields still contain placeholder values:')
    for (const [k] of placeholders) {
      console.warn(`   - ${k}`)
    }
    if (!isDryRun) {
      console.error('\n❌ Fill in all placeholder values before running without --dry-run.')
      process.exit(1)
    }
    console.warn('')
  }

  // Show what would be written
  console.log('Fields to write:')
  for (const [k, v] of Object.entries(FIELDS)) {
    console.log(`   ${k}: ${v}`)
  }
  console.log(`   tenDlcSampleMessages: ${SAMPLE_MESSAGES.length} messages`)
  console.log(`   updatedAt: ${new Date().toISOString()}`)
  console.log('')
  console.log('Fields NOT touched: leads, enrollments, workflows, messages, pilot batches,')
  console.log('                    smsSendingNumber, messagingProfileId, isLive,')
  console.log('                    complianceBlocked, settings, SMS_LIVE_MODE')

  if (isDryRun) {
    console.log('\n✅ Dry run complete — no changes written.')
    console.log('   Remove --dry-run to apply.\n')
    process.exit(0)
  }

  await db.update(tenants).set({
    businessLegalName:    FIELDS.businessLegalName,
    ein:                  FIELDS.ein,
    businessAddress:      FIELDS.businessAddress,
    businessWebsite:      FIELDS.businessWebsite,
    privacyPolicyUrl:     FIELDS.privacyPolicyUrl,
    termsUrl:             FIELDS.termsUrl,
    smsTermsUrl:          FIELDS.smsTermsUrl,
    brandUseCase:         FIELDS.brandUseCase,
    campaignUseCase:      FIELDS.campaignUseCase,
    consentExplanation:   FIELDS.consentExplanation,
    tenDlcStatus:         FIELDS.tenDlcStatus,
    tenDlcSampleMessages: SAMPLE_MESSAGES,
    updatedAt:            new Date(),
  }).where(eq(tenants.id, tenant.id))

  console.log('\n✅ Tenant fields updated successfully.')
  console.log('\n📌 Verify at:')
  console.log('   /admin/dlr/production  — 10DLC Submission Readiness section')
  console.log('   /admin/dlr/go-no-go    — blocker count (should be Telnyx-only)')
  console.log('   /admin/dlr/pilot-pack  — tenant fields in export pack')

  process.exit(0)
}

main().catch(err => {
  console.error('❌ Failed:', err)
  process.exit(1)
})

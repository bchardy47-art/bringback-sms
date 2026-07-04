/**
 * One-off, test-only send of the CORRECTED static email file to Brian.
 *
 * Purpose: verify that the hand-edited HTML in
 *   public/email/DLR Pilot Invite - EMAIL.html
 * renders correctly in a real inbox. This is NOT the production outreach path.
 *
 * Guarantees (by construction):
 *   - Reads the file VERBATIM and sends it as the HTML body.
 *   - Sends ONLY to brian@dlr-sms.com (hardcoded; no recipient arg).
 *   - Does NOT query dealer_prospects or any DB table (no db import).
 *   - Does NOT read or modify the stored dlr_pilot_invite_v1_red_revival template.
 *   - Reuses the existing Resend transport (sendOutreachEmail) — same wire path
 *     as production, but with no eligibility/batch/DB logging side effects.
 *
 * Run:
 *   CONFIRM_SEND_FILE_TEST_TO_BRIAN=SEND_FILE_TEST npx tsx scripts/send-email-file-test-to-brian.ts
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sendOutreachEmail } from '../src/lib/outreach/email'

const TEST_RECIPIENT = 'brian@dlr-sms.com'
const SUBJECT = 'TEST - 30-day free pilot for Utah dealerships'
const FILE_PATH = join(process.cwd(), 'public', 'email', 'DLR Pilot Invite - EMAIL.html')
const REQUIRED_CONFIRM = 'SEND_FILE_TEST'

// Minimal plain-text fallback (Resend wants a text part). The HTML file is the
// thing under test; this is only for clients that refuse HTML.
const TEXT_FALLBACK = [
  'DLR — 30-day free pilot for Utah dealerships.',
  '',
  'This is a TEST send of the corrected pilot-invite email.',
  'Claim your 30-day free pilot: mailto:brian@dlr-sms.com?subject=DLR 30-Day Free Pilot',
  '',
  'Or just reply to this email — it comes straight to me. — Brian',
  '',
  'If this is not a fit, reply "no" and we will not follow up.',
].join('\n')

async function main() {
  const confirmed = process.env.CONFIRM_SEND_FILE_TEST_TO_BRIAN === REQUIRED_CONFIRM

  let html: string
  try {
    html = readFileSync(FILE_PATH, 'utf8')
  } catch (err) {
    console.error(`Could not read email file at ${FILE_PATH}:`, err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  console.log(`file=${FILE_PATH}`)
  console.log(`bytes=${Buffer.byteLength(html, 'utf8')}`)
  console.log(`recipient=${TEST_RECIPIENT}`)
  console.log(`subject=${SUBJECT}`)
  console.log(`mode=${confirmed ? 'SEND' : 'CONFIRMATION_REQUIRED'}`)

  if (!confirmed) {
    console.log('No email sent.')
    console.log(`Run: CONFIRM_SEND_FILE_TEST_TO_BRIAN=${REQUIRED_CONFIRM} npx tsx scripts/send-email-file-test-to-brian.ts`)
    process.exit(1)
  }

  const result = await sendOutreachEmail({
    to: TEST_RECIPIENT,
    subject: SUBJECT,
    text: TEXT_FALLBACK,
    html,
  })

  console.log('result=' + JSON.stringify(result))
  process.exit(result.sent ? 0 : 1)
}

main().catch((err) => {
  console.error('send-email-file-test-to-brian failed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})

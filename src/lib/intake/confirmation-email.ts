/**
 * Dealer intake confirmation email — sent once when the dealer completes
 * Stage 2 of the onboarding form.
 *
 * Why this exists: after pressing "Submit" the dealer only sees a short
 * "You're all set" card. Without an email they don't know we actually
 * received their data, what we'll do next, or how long carrier (10DLC)
 * approval takes. This module sends a single confirmation note covering
 * those three things, then signs off as Brian / BCHardy LLC with the
 * support@dlr-sms.com reply-to.
 *
 * Trigger: the POST handler in
 *   src/app/api/intake/[token]/route.ts
 * calls sendIntakeReceivedEmail() exactly once per successful Stage 2
 * submission. Re-submissions are blocked by the handler with HTTP 409,
 * so a single intake row can only ever trigger one email.
 *
 * Failure model: the helper catches all SMTP errors internally and
 * returns void — the caller never has to worry about email failures
 * blocking the intake submission. If SMTP_URL or EMAIL_FROM are unset
 * the helper logs a clear warning and skips silently.
 *
 * Borrowed pattern from src/lib/alerts.ts (the revival-alert email).
 * No new env vars; no schema changes; no DB writes — only the existing
 * SMTP transport plus a single SELECT for the intake row.
 */

import { eq } from 'drizzle-orm'
import nodemailer from 'nodemailer'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'

// ── Public entry point ────────────────────────────────────────────────────────

export async function sendIntakeReceivedEmail(intakeId: string): Promise<void> {
  const smtpUrl   = process.env.SMTP_URL
  const emailFrom = process.env.EMAIL_FROM

  if (!smtpUrl || !emailFrom) {
    console.warn(
      `[intake/confirmation-email] SMTP_URL or EMAIL_FROM not configured — ` +
      `skipping confirmation email for intake ${intakeId}`,
    )
    return
  }

  try {
    const intake = await db.query.dealerIntakes.findFirst({
      where: eq(dealerIntakes.id, intakeId),
    })
    if (!intake) {
      console.warn(`[intake/confirmation-email] Intake ${intakeId} not found`)
      return
    }

    const recipient =
      intake.alertEmail?.trim() ||
      intake.primaryContactEmail?.trim() ||
      null

    if (!recipient) {
      console.warn(
        `[intake/confirmation-email] No alert or primary contact email on intake ${intakeId} — ` +
        `cannot send confirmation`,
      )
      return
    }

    const dealershipName  = intake.dealershipName?.trim() || 'your dealership'
    const recipientName   = intake.primaryContactName?.trim() || ''
    const paymentReceived =
      intake.paymentStatus === 'paid' || intake.paymentStatus === 'manual_billing'

    const subject = `DLR setup received for ${dealershipName}`

    const transporter = nodemailer.createTransport(smtpUrl)
    await transporter.sendMail({
      from:    `DLR Setup <${emailFrom}>`,
      to:      recipient,
      replyTo: 'support@dlr-sms.com',
      subject,
      text:    buildPlainText({ dealershipName, recipientName, paymentReceived }),
      html:    buildHtml({ dealershipName, recipientName, paymentReceived }),
    })

    console.log(
      `[intake/confirmation-email] Sent confirmation to ${recipient} ` +
      `for "${dealershipName}" (intake ${intakeId})`,
    )
  } catch (err) {
    // Never propagate to the caller — intake submission must succeed even
    // when the SMTP transport is broken.
    console.error(`[intake/confirmation-email] Failed for intake ${intakeId}:`, err)
  }
}

// ── Body builders ────────────────────────────────────────────────────────────

type BodyInputs = {
  dealershipName:  string
  recipientName:   string
  paymentReceived: boolean
}

function buildPlainText(p: BodyInputs): string {
  const firstName = p.recipientName ? p.recipientName.split(' ')[0] : null
  const greeting  = firstName ? `Hi ${firstName},` : 'Hi,'

  const paymentLine = p.paymentReceived
    ? 'Payment is received and your account is activated.'
    : 'We will follow up with payment details if anything is outstanding.'

  return [
    greeting,
    '',
    `Thanks for completing your DLR setup for ${p.dealershipName}. We received your information.`,
    '',
    paymentLine,
    '',
    'Next, DLR will prepare your carrier (10DLC) registration with the SMS carriers.',
    'Carrier approval typically takes 1 to 3 weeks. We will keep you posted.',
    '',
    "No messages will be sent under your dealership's name until ALL of these are complete:",
    '  1. Carrier registration is approved.',
    '  2. Your sending number is assigned.',
    '  3. You personally review and approve the first batch of message previews.',
    '',
    'If you have any questions or want to send notes to our team, just reply to this email.',
    '',
    '— Brian',
    'DLR by BCHardy LLC',
    'support@dlr-sms.com',
  ].join('\n')
}

function buildHtml(p: BodyInputs): string {
  const firstName = p.recipientName ? p.recipientName.split(' ')[0] : null
  const greeting  = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,'
  const dealer    = escapeHtml(p.dealershipName)

  const paymentLine = p.paymentReceived
    ? '<span style="color:#15803d;font-weight:600;">Payment is received</span> and your account is activated.'
    : 'We will follow up with payment details if anything is outstanding.'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fafafa;margin:0;padding:24px;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #ececec;">
    <div style="padding:24px 28px;border-bottom:1px solid #ececec;">
      <p style="margin:0;font-size:11px;font-weight:600;color:#888;letter-spacing:0.12em;text-transform:uppercase;">
        DLR &middot; Dead Lead Revival
      </p>
      <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#111;line-height:1.3;">
        DLR setup received for ${dealer}
      </h1>
    </div>

    <div style="padding:24px 28px;font-size:15px;line-height:1.6;color:#333;">
      <p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 16px;">
        Thanks for completing your DLR setup for <strong>${dealer}</strong>. We received your information.
      </p>

      <p style="margin:0 0 16px;">${paymentLine}</p>

      <p style="margin:20px 0 6px;font-weight:600;color:#111;">What happens next</p>
      <p style="margin:0 0 16px;">
        DLR will prepare your carrier (10DLC) registration with the SMS carriers.
        Carrier approval typically takes <strong>1 to 3 weeks</strong>. We will keep you posted.
      </p>

      <p style="margin:20px 0 6px;font-weight:600;color:#111;">
        No messages will be sent under your dealership's name until:
      </p>
      <ol style="margin:0 0 20px;padding-left:22px;color:#333;">
        <li style="margin-bottom:6px;">Carrier registration is approved.</li>
        <li style="margin-bottom:6px;">Your sending number is assigned.</li>
        <li>You personally review and approve the first batch of message previews.</li>
      </ol>

      <p style="margin:0 0 20px;color:#555;">
        If you have any questions or want to send notes to our team, just reply to this email.
      </p>

      <p style="margin:24px 0 4px;font-weight:600;color:#111;">— Brian</p>
      <p style="margin:0 0 2px;font-size:13px;color:#666;">DLR by BCHardy LLC</p>
      <p style="margin:0;font-size:13px;">
        <a href="mailto:support@dlr-sms.com" style="color:#111;">support@dlr-sms.com</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

// Minimal HTML escape — protects against bizarre dealership names that
// somehow contain HTML. Not a security boundary (the data is dealer-supplied
// to themselves), just a sanity guard against rendering glitches.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

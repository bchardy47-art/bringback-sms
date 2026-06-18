/**
 * Password-reset email — sent when a user requests a reset link.
 *
 * Mirrors src/lib/intake/dealer-invite-email.ts:
 *   - Returns a structured result so callers can log the outcome.
 *   - All errors are caught internally; a failed send must never block the
 *     server action from completing (the token is already stored).
 *   - Reads SMTP_URL + EMAIL_FROM at runtime; skips gracefully if unset.
 *
 * TODO: populate SMTP_URL and EMAIL_FROM in production .env to enable sending.
 * In development without SMTP, the reset URL is printed to the server console
 * so that engineers can test the full flow locally.
 */

import nodemailer from 'nodemailer'

export type ResetPasswordEmailResult =
  | { sent: true;  recipient: string }
  | { sent: false; reason: 'no_smtp' | 'send_failed' }

export async function sendResetPasswordEmail(params: {
  recipientEmail: string
  resetUrl:       string
  expiresAt:      Date
}): Promise<ResetPasswordEmailResult> {
  const smtpUrl   = process.env.SMTP_URL
  const emailFrom = process.env.EMAIL_FROM

  // Dev/staging fallback — log the URL so engineers can test without SMTP.
  if (!smtpUrl || !emailFrom) {
    console.log(
      `[reset-password-email] SMTP not configured. Reset URL for ${params.recipientEmail}:\n  ${params.resetUrl}`,
    )
    return { sent: false, reason: 'no_smtp' }
  }

  try {
    const transporter = nodemailer.createTransport(smtpUrl)
    await transporter.sendMail({
      from:    `DLR Security <${emailFrom}>`,
      to:      params.recipientEmail,
      replyTo: 'support@dlr-sms.com',
      subject: 'Reset your DLR password',
      text:    buildPlainText(params),
      html:    buildHtml(params),
    })
    console.log(`[reset-password-email] Sent reset link to ${params.recipientEmail}`)
    return { sent: true, recipient: params.recipientEmail }
  } catch (err) {
    console.error(`[reset-password-email] Send failed for ${params.recipientEmail}:`, err)
    return { sent: false, reason: 'send_failed' }
  }
}

// ── Body builders ─────────────────────────────────────────────────────────────

type BodyInputs = {
  recipientEmail: string
  resetUrl:       string
  expiresAt:      Date
}

function formatExpires(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
}

function buildPlainText(p: BodyInputs): string {
  return [
    'We received a request to reset the password for your DLR account.',
    '',
    `Reset your password: ${p.resetUrl}`,
    '',
    `This link expires at ${formatExpires(p.expiresAt)} (60 minutes from now).`,
    '',
    'If you did not request a password reset, you can safely ignore this email.',
    'Your password will not change unless you click the link above.',
    '',
    '— DLR Security',
    'DLR by BCHardy LLC',
    'support@dlr-sms.com',
  ].join('\n')
}

function buildHtml(p: BodyInputs): string {
  const expires = formatExpires(p.expiresAt)
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fafafa;margin:0;padding:24px;color:#111;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #ececec;">
    <div style="padding:20px 28px;border-bottom:1px solid #ececec;">
      <p style="margin:0;font-size:11px;font-weight:600;color:#888;letter-spacing:0.12em;text-transform:uppercase;">
        DLR &middot; Dead Lead Revival
      </p>
      <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#111;line-height:1.3;">
        Reset your password
      </h1>
    </div>

    <div style="padding:24px 28px;font-size:15px;line-height:1.6;color:#333;">
      <p style="margin:0 0 16px;">
        We received a request to reset the password for your DLR account.
        Click the button below to choose a new password.
      </p>

      <p style="margin:24px 0;text-align:center;">
        <a href="${p.resetUrl}"
           style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:10px;">
          Reset Password
        </a>
      </p>

      <p style="margin:0 0 20px;font-size:13px;color:#666;text-align:center;">
        This link expires at ${expires} (60&nbsp;minutes from now).
      </p>

      <p style="margin:0 0 8px;font-size:13px;color:#888;border-top:1px solid #f0f0f0;padding-top:16px;">
        If the button above doesn't work, copy and paste this URL into your browser:
      </p>
      <p style="margin:0 0 20px;font-size:12px;color:#555;word-break:break-all;">
        ${p.resetUrl}
      </p>

      <p style="margin:0 0 16px;font-size:13px;color:#888;">
        If you did not request a password reset, you can safely ignore this email.
        Your password will not change.
      </p>

      <p style="margin:24px 0 4px;font-weight:600;color:#111;font-size:14px;">— DLR Security</p>
      <p style="margin:0 0 2px;font-size:13px;color:#666;">DLR by BCHardy LLC</p>
      <p style="margin:0;font-size:13px;">
        <a href="mailto:support@dlr-sms.com" style="color:#111;">support@dlr-sms.com</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

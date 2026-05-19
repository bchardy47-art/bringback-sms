/**
 * Dealer invite email — sent when an admin generates a one-time invite
 * link from /admin/dlr/dealer-invite.
 *
 * Mirrors src/lib/intake/confirmation-email.ts:
 *   - Returns a structured result so the caller can show "Sent to X"
 *     vs. "SMTP not configured — copy link manually" in the UI.
 *   - All errors are caught internally; the row insertion that created
 *     the invite must still succeed even if SMTP is misconfigured.
 *
 * No DB writes, no schema changes. Reads SMTP_URL + EMAIL_FROM at runtime,
 * uses NEXTAUTH_URL/APP_URL as the base for the invite link.
 */

import nodemailer from 'nodemailer'

export type DealerInviteEmailResult =
  | { sent: true;  recipient: string }
  | { sent: false; reason: 'no_smtp' | 'no_recipient' | 'send_failed' }

export async function sendDealerInviteEmail(params: {
  recipientEmail: string | null
  dealershipName: string
  inviteUrl:      string
  expiresAt:      Date
}): Promise<DealerInviteEmailResult> {
  const smtpUrl   = process.env.SMTP_URL
  const emailFrom = process.env.EMAIL_FROM

  if (!smtpUrl || !emailFrom) {
    return { sent: false, reason: 'no_smtp' }
  }

  const recipient = params.recipientEmail?.trim()
  if (!recipient) {
    return { sent: false, reason: 'no_recipient' }
  }

  try {
    const transporter = nodemailer.createTransport(smtpUrl)
    const subject = `Create your DLR login for ${params.dealershipName}`
    await transporter.sendMail({
      from:    `DLR Setup <${emailFrom}>`,
      to:      recipient,
      replyTo: 'support@dlr-sms.com',
      subject,
      text:    buildPlainText({ ...params, recipient }),
      html:    buildHtml({ ...params, recipient }),
    })
    console.log(
      `[dealer-invite-email] Sent invite to ${recipient} for "${params.dealershipName}"`,
    )
    return { sent: true, recipient }
  } catch (err) {
    console.error(`[dealer-invite-email] Send failed for ${recipient}:`, err)
    return { sent: false, reason: 'send_failed' }
  }
}

// ── Body builders ────────────────────────────────────────────────────────────

type BodyInputs = {
  recipient:      string
  dealershipName: string
  inviteUrl:      string
  expiresAt:      Date
}

function formatExpires(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function buildPlainText(p: BodyInputs): string {
  return [
    `Your DLR setup for ${p.dealershipName} is ready.`,
    '',
    'Create your login to start managing your dealership campaigns.',
    '',
    `Create your login: ${p.inviteUrl}`,
    `(This link expires ${formatExpires(p.expiresAt)}.)`,
    '',
    "Once you're in, you'll be able to:",
    '  - Upload your dead-lead list',
    '  - Review and approve message previews before they go out',
    '  - Monitor live replies as they come in',
    '  - Pause messaging anytime',
    '',
    'No campaigns launch without your approval.',
    '',
    'Reply to this email if you have any questions.',
    '',
    '— Brian',
    'DLR by BCHardy LLC',
    'support@dlr-sms.com',
  ].join('\n')
}

function buildHtml(p: BodyInputs): string {
  const dealer  = escapeHtml(p.dealershipName)
  const expires = formatExpires(p.expiresAt)
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
        Create your DLR login for ${dealer}
      </h1>
    </div>

    <div style="padding:24px 28px;font-size:15px;line-height:1.6;color:#333;">
      <p style="margin:0 0 16px;">
        Your dealership setup is ready. Create your login to start managing your campaigns.
      </p>

      <p style="margin:24px 0;text-align:center;">
        <a href="${p.inviteUrl}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:10px;">
          Create Login
        </a>
      </p>

      <p style="margin:0 0 24px;font-size:13px;color:#666;text-align:center;">
        Link expires ${expires}.
      </p>

      <p style="margin:0 0 6px;font-weight:600;color:#111;">Once you're in, you'll be able to:</p>
      <ul style="margin:0 0 20px;padding-left:22px;color:#333;">
        <li style="margin-bottom:6px;">Upload your dead-lead list</li>
        <li style="margin-bottom:6px;">Review and approve message previews before they go out</li>
        <li style="margin-bottom:6px;">Monitor live replies as they come in</li>
        <li>Pause messaging anytime</li>
      </ul>

      <p style="margin:0 0 16px;color:#15803d;font-weight:600;">
        No campaigns launch without your approval.
      </p>

      <p style="margin:0 0 16px;color:#555;">If you have any questions, just reply to this email.</p>

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

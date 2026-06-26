import { Resend } from 'resend'

const BRIAN_EMAIL = 'brian@dlr-sms.com'
const ADMIN_URL = 'https://dlr-sms.com/admin/dlr/demo-leads'

type DemoRequestNotificationResult =
  | { sent: true; recipient: string }
  | { sent: false; reason: 'no_config' | 'send_failed' }

export async function sendDemoRequestNotification(params: {
  dealershipName: string
  decisionMakerName: string
  phone: string
  email: string
  submittedAt: Date
}): Promise<DemoRequestNotificationResult> {
  const apiKey = process.env.RESEND_API_KEY
  const emailFrom = process.env.EMAIL_FROM

  if (!apiKey || !emailFrom) {
    const missing = [!apiKey && 'RESEND_API_KEY', !emailFrom && 'EMAIL_FROM']
      .filter(Boolean)
      .join(', ')
    console.warn(`[demo-request-notification] Skipped: ${missing} not configured.`)
    return { sent: false, reason: 'no_config' }
  }

  try {
    const resend = new Resend(apiKey)
    const subject = `New DLR demo request: ${params.dealershipName}`
    const { error } = await resend.emails.send({
      from: `DLR Demo Requests <${emailFrom}>`,
      to: BRIAN_EMAIL,
      replyTo: 'support@dlr-sms.com',
      subject,
      text: buildPlainText(params),
      html: buildHtml(params),
    })

    if (error) {
      console.error(
        `[demo-request-notification] Send failed for ${params.dealershipName}:`,
        error.name,
        error.message,
      )
      return { sent: false, reason: 'send_failed' }
    }

    console.log(`[demo-request-notification] Sent notification for ${params.dealershipName} to ${BRIAN_EMAIL}`)
    return { sent: true, recipient: BRIAN_EMAIL }
  } catch (err) {
    console.error(
      `[demo-request-notification] Unexpected error for ${params.dealershipName}:`,
      err instanceof Error ? err.message : String(err),
    )
    return { sent: false, reason: 'send_failed' }
  }
}

function fmt(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildPlainText(p: {
  dealershipName: string
  decisionMakerName: string
  phone: string
  email: string
  submittedAt: Date
}): string {
  return [
    'New DLR demo request received.',
    '',
    `Dealership name: ${p.dealershipName}`,
    `Decision maker/contact name: ${p.decisionMakerName}`,
    `Phone: ${p.phone}`,
    `Email: ${p.email}`,
    `Submitted: ${fmt(p.submittedAt)}`,
    '',
    `Admin: ${ADMIN_URL}`,
  ].join('\n')
}

function buildHtml(p: {
  dealershipName: string
  decisionMakerName: string
  phone: string
  email: string
  submittedAt: Date
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fafafa;margin:0;padding:24px;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #ececec;">
    <div style="padding:20px 28px;border-bottom:1px solid #ececec;">
      <p style="margin:0;font-size:11px;font-weight:600;color:#888;letter-spacing:0.12em;text-transform:uppercase;">DLR &middot; Demo Request</p>
      <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#111;line-height:1.3;">New DLR demo request: ${esc(p.dealershipName)}</h1>
    </div>
    <div style="padding:24px 28px;font-size:15px;line-height:1.65;color:#333;">
      <p style="margin:0 0 14px;"><strong>Dealership name:</strong> ${esc(p.dealershipName)}</p>
      <p style="margin:0 0 14px;"><strong>Decision maker/contact name:</strong> ${esc(p.decisionMakerName)}</p>
      <p style="margin:0 0 14px;"><strong>Phone:</strong> ${esc(p.phone)}</p>
      <p style="margin:0 0 14px;"><strong>Email:</strong> ${esc(p.email)}</p>
      <p style="margin:0 0 22px;"><strong>Submitted:</strong> ${esc(fmt(p.submittedAt))}</p>
      <p style="margin:20px 0 0;">
        <a href="${ADMIN_URL}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:10px;">Open Demo Leads Admin</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

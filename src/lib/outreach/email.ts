/**
 * Outreach email transport — sends a rendered demo invite via the Resend HTTP
 * API (same path as src/lib/email/reset-password-email.ts).
 *
 *   - Returns a structured result so the send orchestrator can log to
 *     outreach_sends with an accurate status/provider id.
 *   - All errors are caught; the caller decides how to record them.
 *   - Reads RESEND_API_KEY + EMAIL_FROM at runtime; reports 'no_config' if unset.
 *
 * This module does NOT decide WHO may be emailed or WHETHER sending is enabled —
 * that's eligibility.ts + send.ts. It only puts a fully-rendered message on the
 * wire to a single recipient.
 */

import { Resend } from 'resend'

export type OutreachEmailResult =
  | { sent: true; provider: 'resend'; providerMessageId: string | null }
  | { sent: false; reason: 'no_config' | 'send_failed'; detail?: string }

export function outreachFromEmail(): string | null {
  return process.env.EMAIL_FROM ?? null
}

/** Display name on outreach emails. Env-overridable via OUTREACH_FROM_NAME. */
export function outreachFromName(): string {
  return process.env.OUTREACH_FROM_NAME ?? 'Brian Hardy | Dead Lead Revival'
}

/** Reply-to for outreach emails. Env-overridable via OUTREACH_REPLY_TO. */
export function outreachReplyTo(): string {
  return process.env.OUTREACH_REPLY_TO ?? 'brian@dlr-sms.com'
}

export async function sendOutreachEmail(params: {
  to: string
  subject: string
  text: string
  html: string
}): Promise<OutreachEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const emailFrom = process.env.EMAIL_FROM

  if (!apiKey || !emailFrom) {
    const missing = [!apiKey && 'RESEND_API_KEY', !emailFrom && 'EMAIL_FROM']
      .filter(Boolean)
      .join(', ')
    console.warn(`[outreach-email] Send skipped: ${missing} not configured.`)
    return { sent: false, reason: 'no_config', detail: `missing ${missing}` }
  }

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from: `${outreachFromName()} <${emailFrom}>`,
      to: params.to,
      replyTo: outreachReplyTo(),
      subject: params.subject,
      text: params.text,
      html: params.html,
    })

    if (error) {
      console.error(`[outreach-email] Send failed for ${params.to}:`, error.name, error.message)
      return { sent: false, reason: 'send_failed', detail: `${error.name}: ${error.message}` }
    }

    console.log(`[outreach-email] Sent to ${params.to} (id: ${data?.id ?? 'n/a'})`)
    return { sent: true, provider: 'resend', providerMessageId: data?.id ?? null }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[outreach-email] Unexpected error for ${params.to}:`, detail)
    return { sent: false, reason: 'send_failed', detail }
  }
}

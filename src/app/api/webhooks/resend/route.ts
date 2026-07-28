import { NextRequest, NextResponse } from 'next/server'
import { logResendWebhookEvent, verifyAndParseResendWebhook } from '@/lib/outreach/resend-webhook'

// POST /api/webhooks/resend
// Resend Dashboard → Webhooks → endpoint:
//   https://dlr-sms.com/api/webhooks/resend
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()

  if (!process.env.RESEND_WEBHOOK_SECRET?.trim()) {
    console.warn('[webhook/resend] RESEND_WEBHOOK_SECRET missing — rejecting request')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  let payload
  try {
    payload = verifyAndParseResendWebhook(rawBody, req.headers)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[webhook/resend] Invalid signature — rejecting request:', msg)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // The Svix message id (stable across retries and replays) is the idempotency key.
  const svixMessageId = req.headers.get('svix-id')

  try {
    await logResendWebhookEvent(payload, svixMessageId)
  } catch (err) {
    // Never silently swallow a production write failure: log it and return a
    // 5xx so Resend retries. logResendWebhookEvent is idempotent (dedupes on
    // provider_event_id + a unique index), so retries are safe.
    console.error('[webhook/resend] failed to store event:', err)
    return NextResponse.json({ error: 'Failed to store webhook event' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

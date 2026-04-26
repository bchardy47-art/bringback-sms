import { NextRequest, NextResponse } from 'next/server'
import { getProvider } from '@/lib/messaging'
import { handleInbound } from '@/lib/messaging/inbound'
import { handleStatusEvent } from '@/lib/messaging/status'

const STATUS_EVENT_TYPES = new Set([
  'message.sent',
  'message.delivered',
  'message.failed',
  'message.delivery_failed',
])

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => { headers[key] = value })

  // ── Signature verification ─────────────────────────────────────────────
  // Skip in development so local simulation scripts don't need a valid key.
  // Always enforce in production.
  if (process.env.NODE_ENV === 'production') {
    const provider = getProvider()
    if (!provider.verifyWebhookSignature(rawBody, headers)) {
      console.warn('[webhook/telnyx] Invalid signature — rejecting request')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = (payload as { data?: { event_type?: string } })?.data?.event_type
  const providerMessageId = (
    payload as { data?: { payload?: { id?: string } } }
  )?.data?.payload?.id

  if (!eventType) {
    return NextResponse.json({ ok: true }) // Unknown shape — ack and discard
  }

  console.log(`[webhook/telnyx] ${eventType} ${providerMessageId ?? '(no msg id)'}`)

  // ── Dispatch ──────────────────────────────────────────────────────────────
  // Idempotency is enforced inside each handler (handleInbound checks
  // providerMessageId before inserting; handleStatusEvent checks status rank).
  // Always return 200 after logging — Telnyx interprets non-200 as a failure
  // and will retry, which would defeat our idempotency guards.
  try {
    if (eventType === 'message.received') {
      const inbound = getProvider().parseInboundWebhook(payload)
      await handleInbound(inbound)
    } else if (STATUS_EVENT_TYPES.has(eventType)) {
      const status = getProvider().parseStatusWebhook(payload)
      await handleStatusEvent(status)
    }
    // Unrecognised event types are silently acked — Telnyx sends several
    // event types we don't use (number.order.*, fax.*, etc.)
  } catch (err) {
    // Log the error but still return 200. Returning non-200 causes Telnyx to
    // retry, which can trigger duplicate processing. We've already logged the
    // failure; a dead-letter queue or alert should handle persistent failures.
    console.error(`[webhook/telnyx] Unhandled error for ${eventType}:`, err)
  }

  return NextResponse.json({ ok: true })
}

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

  try {
    await logResendWebhookEvent(payload)
  } catch (err) {
    console.error('[webhook/resend] handler error:', err)
  }

  return NextResponse.json({ ok: true })
}

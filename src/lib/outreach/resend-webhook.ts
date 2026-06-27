import { Webhook } from 'svix'
import { and, desc, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { outreachEmailEvents, outreachSends } from '@/lib/db/schema'

export type ResendWebhookPayload = Record<string, unknown> & {
  type?: string
  created_at?: string
  data?: {
    created_at?: string
    email_id?: string
    from?: string
    to?: string | string[]
    subject?: string
    click?: { link?: string }
  }
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pickRecipient(payload: ResendWebhookPayload): string | null {
  const data = asObj(payload.data)
  const direct = asString(data?.to)
  if (direct) return direct.toLowerCase()
  const list = Array.isArray(data?.to) ? data?.to : []
  const first = list.find(x => typeof x === 'string' && x.trim())
  return typeof first === 'string' ? first.trim().toLowerCase() : null
}

function eventOccurredAt(payload: ResendWebhookPayload): Date | null {
  const data = asObj(payload.data)
  const raw = asString(data?.created_at) ?? asString(payload.created_at)
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function providerEventId(payload: ResendWebhookPayload): string | null {
  return asString((payload as Record<string, unknown>).id)
    ?? asString(asObj(payload.data)?.id)
    ?? asString(asObj(payload.data)?.event_id)
}

function nestedString(obj: Record<string, unknown> | null | undefined, key: string): string | null {
  return asString(obj?.[key])
}

function resendEmailId(payload: ResendWebhookPayload): string | null {
  const data = asObj(payload.data)
  const emailObj = asObj(data?.email)
  return asString(data?.email_id)
    ?? nestedString(emailObj, 'id')
    ?? asString((payload as Record<string, unknown>).email_id)
}

function subjectOf(payload: ResendWebhookPayload): string | null {
  return asString(asObj(payload.data)?.subject)
}

export function verifyAndParseResendWebhook(
  rawBody: string,
  headers: Headers,
): ResendWebhookPayload {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) {
    throw new Error('missing_webhook_secret')
  }

  const svixId = headers.get('svix-id') ?? ''
  const svixTimestamp = headers.get('svix-timestamp') ?? ''
  const svixSignature = headers.get('svix-signature') ?? ''
  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new Error('missing_signature_headers')
  }

  const wh = new Webhook(secret)
  return wh.verify(rawBody, {
    'svix-id': svixId,
    'svix-timestamp': svixTimestamp,
    'svix-signature': svixSignature,
  }) as ResendWebhookPayload
}

async function matchOutreachSend(payload: ResendWebhookPayload) {
  const providerId = resendEmailId(payload)
  if (providerId) {
    const exact = await db
      .select({ id: outreachSends.id })
      .from(outreachSends)
      .where(eq(outreachSends.providerMessageId, providerId))
      .limit(1)
    if (exact[0]) return exact[0].id
  }

  const toEmail = pickRecipient(payload)
  const subject = subjectOf(payload)
  const occurredAt = eventOccurredAt(payload)
  if (!toEmail || !subject || !occurredAt) return null

  const windowStart = new Date(occurredAt.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fallback = await db
    .select({ id: outreachSends.id })
    .from(outreachSends)
    .where(
      and(
        eq(outreachSends.toEmail, toEmail),
        eq(outreachSends.subject, subject),
        gte(outreachSends.createdAt, windowStart),
      ),
    )
    .orderBy(desc(outreachSends.createdAt))
    .limit(1)

  return fallback[0]?.id ?? null
}

export async function logResendWebhookEvent(payload: ResendWebhookPayload): Promise<void> {
  const pEventId = providerEventId(payload)
  if (pEventId) {
    const dup = await db
      .select({ id: outreachEmailEvents.id })
      .from(outreachEmailEvents)
      .where(and(
        eq(outreachEmailEvents.provider, 'resend'),
        eq(outreachEmailEvents.providerEventId, pEventId),
      ))
      .limit(1)
    if (dup[0]) return
  }

  const matchedSendId = await matchOutreachSend(payload)
  await db.insert(outreachEmailEvents).values({
    provider: 'resend',
    eventType: asString(payload.type) ?? 'unknown',
    providerEventId: pEventId,
    resendEmailId: resendEmailId(payload),
    toEmail: pickRecipient(payload),
    subject: subjectOf(payload),
    outreachSendId: matchedSendId,
    rawPayload: payload,
    occurredAt: eventOccurredAt(payload),
  })
}

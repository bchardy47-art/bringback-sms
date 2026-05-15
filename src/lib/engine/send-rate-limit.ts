/**
 * Per-number outbound rate limiting.
 *
 * Carriers (and Telnyx itself) throttle 10DLC traffic at the sending number.
 * This guard layer counts outbound messages from a given tenant phone over
 * sliding windows and blocks a send when any window would be exceeded.
 *
 * Limits are env-tunable; defaults are conservative and well below Telnyx's
 * 10DLC throughput ceilings:
 *
 *   SMS_PER_NUMBER_PER_MINUTE   default 30
 *   SMS_PER_NUMBER_PER_HOUR     default 500
 *   SMS_PER_NUMBER_PER_DAY      default 3000
 *
 * The return value carries a `retryAt` hint so callers can DEFER (reschedule)
 * rather than SKIP the step — the throttle is a temporary block, not a permanent
 * one.
 */

import { and, count, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { conversations, messages } from '@/lib/db/schema'

const MINUTE_MS = 60 * 1000
const HOUR_MS   = 60 * MINUTE_MS
const DAY_MS    = 24 * HOUR_MS

const LIMITS = {
  perMinute: Number(process.env.SMS_PER_NUMBER_PER_MINUTE ?? 30),
  perHour:   Number(process.env.SMS_PER_NUMBER_PER_HOUR   ?? 500),
  perDay:    Number(process.env.SMS_PER_NUMBER_PER_DAY    ?? 3000),
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; window: 'minute' | 'hour' | 'day'; retryAt: Date; detail: string }

async function countSentSince(tenantPhone: string, since: Date): Promise<number> {
  // Outbound messages that actually went to the provider — exclude skipped rows.
  // Joined via conversations.tenantPhone (denormalized on every conversation).
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.tenantPhone, tenantPhone),
        eq(messages.direction, 'outbound'),
        gte(messages.createdAt, since),
      ),
    )
  return Number(row?.n ?? 0)
}

export async function checkPerNumberRateLimit(tenantPhone: string, now: Date = new Date()): Promise<RateLimitResult> {
  // Cheapest window first — most sends will be far below the per-minute limit.
  const sinceMinute = new Date(now.getTime() - MINUTE_MS)
  const minuteCount = await countSentSince(tenantPhone, sinceMinute)
  if (minuteCount >= LIMITS.perMinute) {
    return {
      allowed: false,
      window: 'minute',
      retryAt: new Date(now.getTime() + MINUTE_MS),
      detail: `Sent ${minuteCount} messages from ${tenantPhone} in the last minute (limit ${LIMITS.perMinute})`,
    }
  }

  const sinceHour = new Date(now.getTime() - HOUR_MS)
  const hourCount = await countSentSince(tenantPhone, sinceHour)
  if (hourCount >= LIMITS.perHour) {
    return {
      allowed: false,
      window: 'hour',
      retryAt: new Date(now.getTime() + HOUR_MS),
      detail: `Sent ${hourCount} messages from ${tenantPhone} in the last hour (limit ${LIMITS.perHour})`,
    }
  }

  const sinceDay = new Date(now.getTime() - DAY_MS)
  const dayCount = await countSentSince(tenantPhone, sinceDay)
  if (dayCount >= LIMITS.perDay) {
    return {
      allowed: false,
      window: 'day',
      retryAt: new Date(now.getTime() + DAY_MS),
      detail: `Sent ${dayCount} messages from ${tenantPhone} in the last day (limit ${LIMITS.perDay})`,
    }
  }

  return { allowed: true }
}

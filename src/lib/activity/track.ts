/**
 * First-party activity tracking — writes to the `activity_events` table.
 *
 * Design rules:
 *   • BEST-EFFORT: every write is wrapped so a failure (e.g. table not yet
 *     migrated, slow DB) can NEVER break a page render or the auth flow.
 *   • PRIVACY: raw IPs are never stored — only sha256(salt + ip), truncated.
 *     No SMS bodies, no lead phone numbers. Keep `metadata` minimal.
 *   • Denormalised: actor + tenant are snapshotted onto the row.
 *
 * Server-only. Call from server components / server actions / NextAuth events.
 */

import { createHash } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { activityEvents, tenants } from '@/lib/db/schema'

const IP_SALT = process.env.ACTIVITY_IP_SALT ?? 'dlr-activity-v1'

export type ActivityActor = {
  id?: string | null
  email?: string | null
  role?: string | null
  tenantId?: string | null
  tenantName?: string | null
}

export type TrackOptions = {
  actor?: ActivityActor | null
  path?: string | null
  method?: string | null
  /** Keep tiny + non-sensitive. Never message bodies or phone numbers. */
  metadata?: Record<string, unknown> | null
  /** Skip the request-header read (use for NextAuth events with no request scope). */
  skipHeaders?: boolean
}

function hashIp(ip: string): string {
  return createHash('sha256').update(`${IP_SALT}:${ip}`).digest('hex').slice(0, 32)
}

/**
 * Record an activity event. Resolves the actor from the NextAuth session when
 * one isn't passed. Always resolves; never throws.
 */
export async function trackEvent(eventType: string, opts: TrackOptions = {}): Promise<void> {
  try {
    let actor = opts.actor ?? null

    // Fall back to the session only when no actor was supplied. Imported lazily
    // to avoid pulling auth into modules that just want to log.
    if (!actor) {
      try {
        const { getServerSession } = await import('next-auth')
        const { authOptions } = await import('@/lib/auth')
        const session = await getServerSession(authOptions)
        if (session?.user) {
          actor = {
            id: session.user.id,
            email: session.user.email,
            role: session.user.role,
            tenantId: session.user.tenantId,
          }
        }
      } catch {
        /* no session context — fine, log an anonymous event */
      }
    }

    // Snapshot the tenant name (cheap PK lookup) when we have an id but no name.
    let tenantName = actor?.tenantName ?? null
    if (!tenantName && actor?.tenantId) {
      try {
        const row = await db
          .select({ name: tenants.name })
          .from(tenants)
          .where(eq(tenants.id, actor.tenantId))
          .limit(1)
        tenantName = row[0]?.name ?? null
      } catch {
        /* ignore */
      }
    }

    let userAgent: string | null = null
    let ipHash: string | null = null
    if (!opts.skipHeaders) {
      try {
        // Lazy import so non-Next runtimes (e.g. plain `tsx` CLI scripts) don't
        // fail to load this module; outside a request scope this throws and is
        // caught below, leaving userAgent/ipHash null.
        const { headers } = await import('next/headers')
        const h = headers()
        userAgent = (h.get('user-agent') ?? '').slice(0, 300) || null
        const fwd = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? ''
        const ip = fwd.split(',')[0].trim()
        if (ip) ipHash = hashIp(ip)
      } catch {
        /* headers() unavailable outside request scope — fine */
      }
    }

    // actorUserId is a uuid column; only pass it through when it looks like one
    // (dev-bypass synthetic ids may not be uuids — keep the write safe).
    const isUuid = (s?: string | null) =>
      !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

    await db.insert(activityEvents).values({
      eventType,
      actorUserId: isUuid(actor?.id) ? (actor!.id as string) : null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      tenantId: isUuid(actor?.tenantId) ? (actor!.tenantId as string) : null,
      tenantName,
      path: opts.path ?? null,
      method: opts.method ?? null,
      userAgent,
      ipHash,
      metadata: opts.metadata ?? null,
    })
  } catch {
    // Best-effort: swallow everything so tracking can never break a request.
  }
}

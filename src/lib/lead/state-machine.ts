import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, leadStateHistory } from '@/lib/db/schema'

export type LeadState =
  | 'active'
  | 'stale'
  | 'orphaned'
  | 'enrolled'
  | 'responded'
  | 'revived'
  | 'exhausted'
  | 'converted'
  | 'opted_out'
  | 'dead'

// Defines which transitions are allowed. Key = from state, value = allowed to states.
const ALLOWED_TRANSITIONS: Record<LeadState, LeadState[]> = {
  active:    ['stale', 'orphaned', 'opted_out', 'dead'],
  stale:     ['enrolled', 'opted_out', 'dead'],
  orphaned:  ['enrolled', 'opted_out', 'dead'],
  enrolled:  ['responded', 'exhausted', 'opted_out', 'dead'],
  responded: ['revived', 'opted_out', 'dead'],
  revived:   ['converted', 'enrolled', 'opted_out', 'dead'],
  exhausted: ['enrolled', 'opted_out', 'dead'],
  converted: ['dead'],
  opted_out: ['active', 'dead'], // UNSTOP can re-activate
  dead:      [],
}

export function isValidTransition(from: LeadState, to: LeadState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export async function transition(
  leadId: string,
  to: LeadState,
  opts: { reason?: string; actor?: string } = {}
): Promise<void> {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
  if (!lead) throw new Error(`Lead ${leadId} not found`)

  const from = lead.state as LeadState

  if (from === to) return // idempotent — no-op if already in target state

  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to} for lead ${leadId}`)
  }

  const now = new Date()
  const updates: Partial<typeof leads.$inferInsert> = {
    state: to,
    updatedAt: now,
  }

  if (to === 'stale') updates.staleAt = now
  if (to === 'enrolled') updates.enrolledAt = now
  if (to === 'revived') updates.revivedAt = now

  await db.transaction(async (tx) => {
    await tx.update(leads).set(updates).where(eq(leads.id, leadId))
    await tx.insert(leadStateHistory).values({
      leadId,
      fromState: from,
      toState: to,
      reason: opts.reason,
      actor: opts.actor ?? 'system',
    })
  })
}

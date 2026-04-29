import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, leadStateHistory } from '@/lib/db/schema'

export type LeadState =
  | 'active'
  | 'stale'
  | 'orphaned'
  | 'revival_eligible'  // passed suppression — waiting for enrollment
  | 'enrolled'
  | 'responded'
  | 'revived'
  | 'exhausted'
  | 'converted'
  | 'opted_out'
  | 'dead'

// ── Allowed transitions ───────────────────────────────────────────────────────
//
// Key design decisions:
//
//  • stale / orphaned  → revival_eligible ONLY (no direct → enrolled)
//    The eligibility agent is the sole gatekeeper between candidate and enrolled.
//
//  • revival_eligible  → enrolled (enrollment agent picks these up)
//    Can also fall back to stale (if eligibility is re-run and conditions change)
//    or move to opted_out / dead if discovered during eligibility.
//
//  • revived           → enrolled is still allowed (manual human re-enrollment
//    after a warm conversation — not an auto path).
//
//  • exhausted         → revival_eligible (goes back through eligibility before
//    being re-enrolled; the eligibility pass will enforce cooldown).

const ALLOWED_TRANSITIONS: Record<LeadState, LeadState[]> = {
  active:           ['stale', 'orphaned', 'opted_out', 'dead'],
  stale:            ['revival_eligible', 'opted_out', 'dead'],           // ← no longer direct → enrolled
  orphaned:         ['revival_eligible', 'opted_out', 'dead'],           // ← no longer direct → enrolled
  revival_eligible: ['enrolled', 'stale', 'opted_out', 'dead'],         // ← the eligibility gate
  enrolled:         ['responded', 'exhausted', 'opted_out', 'dead'],
  responded:        ['revived', 'opted_out', 'dead'],
  revived:          ['converted', 'enrolled', 'opted_out', 'dead'],     // manual re-enroll OK
  exhausted:        ['revival_eligible', 'stale', 'opted_out', 'dead'], // back through eligibility
  converted:        ['dead'],
  opted_out:        ['active', 'dead'],                                  // UNSTOP re-activates
  dead:             [],
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

  // Stamp convenience timestamps on key transitions
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

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { leads, workflowEnrollments } from '@/lib/db/schema'

export async function escalateToHuman(
  enrollmentId: string,
  reason: string
): Promise<void> {
  const enrollment = await db.query.workflowEnrollments.findFirst({
    where: eq(workflowEnrollments.id, enrollmentId),
  })
  if (!enrollment) return

  // Pause the enrollment so no further steps fire
  await db
    .update(workflowEnrollments)
    .set({ status: 'paused' })
    .where(eq(workflowEnrollments.id, enrollmentId))

  // Flag the lead with escalation metadata so the inbox UI can surface it
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, enrollment.leadId),
  })
  if (lead) {
    await db
      .update(leads)
      .set({
        metadata: {
          ...(lead.metadata as Record<string, unknown>),
          escalated: true,
          escalationReason: reason,
          escalatedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(leads.id, enrollment.leadId))
  }

  console.warn(`[engine] Escalated enrollment ${enrollmentId}: ${reason}`)
  // Future: send email/push notification to assigned user or manager here
}

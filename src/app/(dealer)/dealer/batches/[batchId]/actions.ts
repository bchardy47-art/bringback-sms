'use server'

import { getServerSession } from 'next-auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { pilotBatches } from '@/lib/db/schema'
import { recordAttestation, extractClientContext } from '@/lib/compliance/attestation'
import {
  CAMPAIGN_APPROVAL_TEXT,
  CAMPAIGN_APPROVAL_VERSION,
} from '@/lib/compliance/attestation-text'

/**
 * Dealer-callable batch approve action.
 *
 * Scoped by session.user.tenantId — a dealer can only approve their own batches.
 * Accepts batches in 'draft' or 'previewed' status (dealer review is the gate,
 * not an intermediate preview step).
 *
 * Compliance (C-2):
 *   - Caller MUST pass `params.attested === true`. The client component
 *     gates this behind an explicit approval checkbox; this server check
 *     is the defense-in-depth backstop.
 *   - A compliance_attestations row is written BEFORE the status flip.
 *     If the attestation write fails the action throws and the batch
 *     status is unchanged. Strict-write policy.
 */
export async function approveDealerBatch(
  batchId: string,
  params?: { attested?: boolean },
): Promise<void> {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') {
    throw new Error('Unauthorized: dealer role required')
  }

  // ── C-2: attestation gate ──────────────────────────────────────────────
  if (!params?.attested) {
    throw new Error('Approval attestation is required to approve this batch')
  }

  const batch = await db.query.pilotBatches.findFirst({
    where: and(
      eq(pilotBatches.id, batchId),
      eq(pilotBatches.tenantId, session.user.tenantId),
    ),
  })

  if (!batch) {
    throw new Error('Batch not found or does not belong to your dealership')
  }

  if (!['draft', 'previewed'].includes(batch.status)) {
    throw new Error(`Cannot approve a batch with status "${batch.status}"`)
  }

  // ── C-2: write attestation FIRST (strict policy) ───────────────────────
  // headers() comes from next/headers — Next.js server-action equivalent
  // of NextRequest.headers. Works on the same Headers interface as the
  // API-route path so extractClientContext can be shared.
  const { ipAddress, userAgent } = extractClientContext(headers())
  await recordAttestation({
    tenantId:               session.user.tenantId,
    userId:                 session.user.id,
    type:                   'campaign_launch_approval',
    resourceType:           'pilot_batch',
    resourceId:             batchId,
    textVersion:            CAMPAIGN_APPROVAL_VERSION,
    attestationText:        CAMPAIGN_APPROVAL_TEXT,
    messageTemplateVersion: null, // no template versioning yet
    ipAddress,
    userAgent,
    metadata:               { previousStatus: batch.status },
  })

  // Now flip status. If recordAttestation threw above we never get here.
  const approvedBy = session.user.email ?? session.user.name ?? session.user.id
  const now = new Date()

  await db
    .update(pilotBatches)
    .set({
      status:     'approved',
      approvedBy,
      approvedAt: now,
      updatedAt:  now,
    })
    .where(eq(pilotBatches.id, batchId))

  revalidatePath(`/dealer/batches/${batchId}`)
  revalidatePath('/dealer/batches')
  revalidatePath('/dealer/dashboard')
}

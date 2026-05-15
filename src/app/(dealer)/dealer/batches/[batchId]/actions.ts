'use server'

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { pilotBatches } from '@/lib/db/schema'

/**
 * Dealer-callable batch approve action.
 *
 * Scoped by session.user.tenantId — a dealer can only approve their own batches.
 * Accepts batches in 'draft' or 'previewed' status (dealer review is the gate,
 * not an intermediate preview step).
 */
export async function approveDealerBatch(batchId: string) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') {
    throw new Error('Unauthorized: dealer role required')
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

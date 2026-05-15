'use server'

import { randomBytes } from 'crypto'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { dealerInvites } from '@/lib/db/schema'

/**
 * Generate a one-time dealer invite link for a given tenant.
 * The link is valid for 7 days.
 */
export async function generateDealerInvite(tenantId: string, email?: string) {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Unauthorized')
  if (session.user.role !== 'admin') throw new Error('Admin role required')

  if (!tenantId) throw new Error('tenantId is required')

  const token     = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await db.insert(dealerInvites).values({
    tenantId,
    token,
    email: email ?? null,
    expiresAt,
  })

  return { token, expiresAt }
}

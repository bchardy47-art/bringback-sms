/**
 * Admin access helpers — server-side only.
 *
 * Two tiers of gate sit on top of the existing role model:
 *
 *   role === 'admin'                  → may VIEW the internal admin console.
 *   email === BRIAN_EMAIL (+ admin)   → may operate the dangerous outreach
 *                                        send tools (real prospect emails).
 *
 * The (dashboard)/admin layout already redirects non-admins. These helpers add
 * the Brian-only second tier and give server actions a single source of truth
 * so guards can't drift between a hidden button and the action behind it.
 *
 * NEVER trust a hidden button — every outreach mutation calls assertBrian().
 */

import 'server-only'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/** The single operator allowed to send real dealer outreach. */
export const BRIAN_EMAIL = 'brian@dlr-sms.com'

export type AdminSessionUser = {
  id: string
  email: string
  name: string
  role: string
  tenantId: string
}

function normalize(email?: string | null): string {
  return (email ?? '').trim().toLowerCase()
}

/** True only for the Brian operator account (and only when they're an admin). */
export function isBrian(user?: { email?: string | null; role?: string | null } | null): boolean {
  if (!user) return false
  return user.role === 'admin' && normalize(user.email) === BRIAN_EMAIL
}

/**
 * Resolve the current admin session, or null if the caller isn't an admin.
 * Use in server components that have already been gated by the layout but want
 * the typed user; use assertAdmin() when you need a hard failure.
 */
export async function getAdminUser(): Promise<AdminSessionUser | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== 'admin') return null
  return session.user as AdminSessionUser
}

/** Throws unless the caller is an admin. For server actions / route handlers. */
export async function assertAdmin(): Promise<AdminSessionUser> {
  const user = await getAdminUser()
  if (!user) throw new Error('forbidden: admin only')
  return user
}

/**
 * Throws unless the caller is the Brian operator account. Guards every
 * outreach SEND action (real emails, test emails, batch sends, DNC writes).
 */
export async function assertBrian(): Promise<AdminSessionUser> {
  const user = await assertAdmin()
  if (!isBrian(user)) throw new Error('forbidden: outreach sending is restricted to brian@dlr-sms.com')
  return user
}

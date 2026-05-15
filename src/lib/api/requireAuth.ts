import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import type { UserRole } from '@/types/next-auth'

export type AuthSession = {
  user: {
    id: string
    email: string
    name: string
    tenantId: string
    role: UserRole
  }
}

type AuthResult =
  | { session: AuthSession; error: null }
  | { session: null; error: NextResponse }

export async function requireAuth(): Promise<AuthResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { session: session as AuthSession, error: null }
}

const ROLE_RANK: Record<UserRole, number> = {
  dealer: 0,
  agent: 1,
  manager: 2,
  admin: 3,
}

export async function requireRole(min: UserRole): Promise<AuthResult> {
  const result = await requireAuth()
  if (result.error) return result
  if (ROLE_RANK[result.session.user.role] < ROLE_RANK[min]) {
    return { session: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return result
}

export function requireAdmin(): Promise<AuthResult> {
  return requireRole('admin')
}

export function requireManager(): Promise<AuthResult> {
  return requireRole('manager')
}

/**
 * Dealer-only gate. Unlike requireRole('dealer') (which would allow every
 * role at or above dealer rank), this asserts role *equals* 'dealer'. Use
 * on routes that mirror admin operations for the dealer's own tenant —
 * the dealer route shells under /api/dealer/** call this so an admin
 * accidentally hitting those shells gets a clear 403 and continues to
 * use /api/admin/** instead.
 */
export async function requireDealer(): Promise<AuthResult> {
  const result = await requireAuth()
  if (result.error) return result
  if (result.session.user.role !== 'dealer') {
    return { session: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return result
}

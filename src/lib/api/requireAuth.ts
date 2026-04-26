import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'

export type AuthSession = {
  user: {
    id: string
    email: string
    name: string
    tenantId: string
    role: string
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

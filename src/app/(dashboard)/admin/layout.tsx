import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'

// Server-side admin gate for the internal-team console (/admin/**).
// Middleware keeps dealers out; this layout additionally keeps managers
// and agents out, so cross-tenant data (intakes, pilot pack, live ops,
// dealer invites) is only ever rendered for role === 'admin'.
export default async function AdminConsoleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/admin/dlr')
  if (session.user.role !== 'admin') redirect('/dashboard')
  return <>{children}</>
}

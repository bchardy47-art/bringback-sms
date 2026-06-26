import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AdminModeBanner } from '@/components/admin/AdminModeBanner'
import { AdminNav } from '@/components/admin/AdminNav'

// Server-side admin gate for the internal-team console (/admin/**).
// Middleware keeps dealers out; this layout additionally keeps managers
// and agents out, so cross-tenant data (intakes, pilot pack, live ops,
// dealer invites) is only ever rendered for role === 'admin'.
//
// This layout also owns the two surfaces that should appear on EVERY admin
// page: the plain-English mode banner (test vs live) and the single primary
// admin nav. Both are display/navigation only — no send or env behaviour.
export default async function AdminConsoleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/admin')
  if (session.user.role !== 'admin') redirect('/dashboard')

  // Resolve the live/test posture once for the banner. Display-only: reading
  // these never arms or changes any send path.
  const smsLive =
    process.env.SMS_LIVE_MODE === 'true' && process.env.DRY_RUN !== 'true'
  const outreachArmed = process.env.OUTREACH_SEND_ENABLED === 'true'

  return (
    <div className="min-h-full">
      <AdminModeBanner smsLive={smsLive} outreachArmed={outreachArmed} />
      <AdminNav />
      {children}
    </div>
  )
}

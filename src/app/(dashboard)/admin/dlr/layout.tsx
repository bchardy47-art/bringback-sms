import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'

// Nav order follows the launch workflow:
//   Setup → Pilot Prep → Approval Gate → Execution → Operations
const NAV = [
  // ── Always first ─────────────────────────────────────────────────
  { href: '/admin/dlr',              label: 'Overview' },
  { href: '/admin/dlr/intakes',      label: '🏠 Intakes' },
  // ── Setup (do these before importing leads) ───────────────────────
  { href: '/admin/dlr/production',   label: 'Production' },
  { href: '/admin/dlr/readiness',    label: 'Readiness' },
  { href: '/admin/dlr/workflows',    label: 'Workflows' },
  // ── Pilot prep (import → review → pack) ──────────────────────────
  { href: '/admin/dlr/pilot-leads',  label: 'Pilot Leads' },
  { href: '/admin/dlr/pilot-pack',   label: 'Pilot Pack' },
  { href: '/admin/dlr/go-no-go',     label: 'Go / No-Go' },
  // ── Execution (batch → first pilot → live) ────────────────────────
  { href: '/admin/dlr/pilot',        label: 'Pilot' },
  { href: '/admin/dlr/pre-live',     label: 'Pre-Live' },
  { href: '/admin/dlr/first-pilot',  label: 'First Pilot' },
  { href: '/admin/dlr/live-pilot',   label: 'Live Pilot' },
  // ── Operations ───────────────────────────────────────────────────
  { href: '/admin/dlr/handoffs',     label: 'Handoff Queue' },
  { href: '/admin/dlr/messages',     label: 'Message Audit' },
  { href: '/admin/dlr/health',       label: 'Health' },
  { href: '/admin/dlr/suppression',  label: 'Suppression' },
]

export default async function DlrAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect('/login')
  if (session.user.role !== 'admin') redirect('/')

  return (
    <div className="min-h-full bg-gray-50">
      {/* Sub-nav */}
      <div className="bg-white border-b border-gray-200 px-8">
        <div className="flex items-center gap-1 py-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-3">
            DLR Admin
          </span>
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}

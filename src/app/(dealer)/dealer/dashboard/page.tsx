import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq, and, count } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  pilotBatches,
  pilotLeadImports,
  conversations,
  tenants,
} from '@/lib/db/schema'

export default async function DealerDashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

  const [[tenantRow], [importRow], [draftRow], [activeRow], [inboxRow]] = await Promise.all([
    db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)),

    // Total lead imports
    db.select({ count: count() })
      .from(pilotLeadImports)
      .where(eq(pilotLeadImports.tenantId, tenantId)),

    // Draft batches awaiting review
    db.select({ count: count() })
      .from(pilotBatches)
      .where(and(eq(pilotBatches.tenantId, tenantId), eq(pilotBatches.status, 'draft'))),

    // Approved / active batches
    db.select({ count: count() })
      .from(pilotBatches)
      .where(and(eq(pilotBatches.tenantId, tenantId), eq(pilotBatches.status, 'approved'))),

    // Open inbox conversations
    db.select({ count: count() })
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.status, 'open'))),
  ])

  const dealershipName = tenantRow?.name ?? 'Your Dealership'
  const importCount    = importRow?.count   ?? 0
  const draftCount     = draftRow?.count    ?? 0
  const activeCount    = activeRow?.count   ?? 0
  const inboxCount     = inboxRow?.count    ?? 0

  const firstName = session.user.name?.split(' ')[0] ?? 'there'

  const stats = [
    {
      label: 'Leads Imported',
      value: importCount,
      href:  '/dealer/import',
      color: 'text-gray-900',
      bg:    'bg-white',
      desc:  'Total leads in your pipeline',
    },
    {
      label: 'Batches Awaiting Review',
      value: draftCount,
      href:  '/dealer/batches',
      color: draftCount > 0 ? 'text-blue-700' : 'text-gray-300',
      bg:    draftCount > 0 ? 'bg-blue-50'    : 'bg-white',
      desc:  'Draft batches ready for your approval',
    },
    {
      label: 'Approved Batches',
      value: activeCount,
      href:  '/dealer/batches',
      color: 'text-emerald-700',
      bg:    'bg-white',
      desc:  'Batches you have approved',
    },
    {
      label: 'Open Conversations',
      value: inboxCount,
      href:  '/dealer/inbox',
      color: inboxCount > 0 ? 'text-orange-600' : 'text-gray-300',
      bg:    inboxCount > 0 ? 'bg-orange-50'   : 'bg-white',
      desc:  'Replies waiting in your inbox',
    },
  ]

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">

      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Hey {firstName} 👋
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {dealershipName} — here&apos;s where your Dead Lead Revival pipeline stands.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4">
        {stats.map(({ label, value, href, color, bg, desc }) => (
          <a
            key={label}
            href={href}
            className={`${bg} border border-gray-200 rounded-xl px-6 py-5 shadow-sm hover:shadow transition-shadow block`}
          >
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className="text-sm font-semibold text-gray-700 mt-1">{label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
          </a>
        ))}
      </div>

      {/* Quick actions */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-900">Quick Actions</p>
        </div>
        <div className="divide-y divide-gray-100">
          <a
            href="/dealer/import"
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div>
              <p className="text-sm font-semibold text-gray-800">Import Leads</p>
              <p className="text-xs text-gray-500">Upload a CSV of dead leads from your CRM</p>
            </div>
            <span className="text-gray-400 text-sm">→</span>
          </a>
          <a
            href="/dealer/batches"
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">Review Batches</p>
                <p className="text-xs text-gray-500">Preview message sequences and approve pilot batches</p>
              </div>
              {draftCount > 0 && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                  {draftCount} pending
                </span>
              )}
            </div>
            <span className="text-gray-400 text-sm">→</span>
          </a>
          <a
            href="/dealer/inbox"
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">Open Inbox</p>
                <p className="text-xs text-gray-500">See replies and hand off hot leads to your team</p>
              </div>
              {inboxCount > 0 && (
                <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-bold rounded-full">
                  {inboxCount} open
                </span>
              )}
            </div>
            <span className="text-gray-400 text-sm">→</span>
          </a>
        </div>
      </div>

      {/* Empty state guidance */}
      {importCount === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 px-8 text-center">
          <p className="text-base font-semibold text-gray-700 mb-2">Start your first revival</p>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Upload a CSV of dead leads from your CRM. DLR will classify them, build message sequences,
            and let you review everything before a single text is sent.
          </p>
          <a
            href="/dealer/import"
            className="mt-5 inline-block px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 transition-colors"
          >
            Import your first leads →
          </a>
        </div>
      )}
    </div>
  )
}

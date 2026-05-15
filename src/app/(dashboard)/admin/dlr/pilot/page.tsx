import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { pilotBatches, workflows } from '@/lib/db/schema'
import { HARD_PILOT_CAP } from '@/lib/db/schema'
import { NoLiveSMSBanner } from '@/components/admin/NoLiveSMSBanner'

const STATUS_COLOR: Record<string, string> = {
  draft:      'bg-gray-100 text-gray-600',
  previewed:  'bg-blue-100 text-blue-700',
  approved:   'bg-teal-100 text-teal-700',
  sending:    'bg-green-100 text-green-700',
  paused:     'bg-yellow-100 text-yellow-700',
  completed:  'bg-gray-100 text-gray-500',
  cancelled:  'bg-red-100 text-red-600',
}

export default async function PilotListPage({
  searchParams,
}: {
  searchParams?: { tenantId?: string; batchId?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  // Admin can pass ?tenantId= to view any tenant's batches (used by batch-queue nav links)
  const tenantId = searchParams?.tenantId ?? session.user.tenantId

  const batches = await db.query.pilotBatches.findMany({
    where: eq(pilotBatches.tenantId, tenantId),
    with: {
      leads: true,
      workflow: true,
    },
    orderBy: [desc(pilotBatches.createdAt)],
  })

  // Load workflows for the create form
  const availableWorkflows = await db.query.workflows.findMany({
    where: eq(workflows.tenantId, tenantId),
    orderBy: [workflows.name],
  })

  return (
    <div className="px-8 py-6 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Pilot Batches</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manually-approved batches of up to {HARD_PILOT_CAP} leads. Preview → Approve → Send.
            Batches stay in <strong>draft</strong> until live send approval is granted.
          </p>
        </div>
        <Link
          href="/admin/dlr/pilot/new"
          className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          + New Batch
        </Link>
      </div>

      {/* No live SMS banner */}
      <NoLiveSMSBanner reason="Pilot batches stay in draft until 10DLC is approved and live send approval is granted" />

      {/* Batch list */}
      {batches.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-3">
          <p className="text-sm font-semibold text-gray-600">No pilot batches yet.</p>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Import and select your pilot leads first, then create a batch from the Pilot Leads page.
            The batch will be created in draft mode — no sends will occur.
          </p>
          <div className="flex items-center justify-center gap-4 pt-1">
            <Link href="/admin/dlr/pilot-leads" className="text-xs font-semibold text-indigo-600 hover:underline">
              Go to Pilot Leads →
            </Link>
            <Link href="/admin/dlr/pilot-pack" className="text-xs font-semibold text-blue-600 hover:underline">
              Open Pilot Pack →
            </Link>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Workflow', 'Status', 'Leads', 'Sent', 'Blocked', 'Replies', 'Created', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {batches.map(batch => (
                <tr key={batch.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="text-xs font-semibold text-gray-900">{batch.workflow?.name ?? '—'}</p>
                    {batch.workflow?.key && (
                      <p className="text-xs text-gray-400 font-mono">{batch.workflow.key}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[batch.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {batch.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {batch.leads.length} / {batch.maxLeadCount}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-green-700">{batch.liveSendCount}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{batch.blockedCount}</td>
                  <td className="px-4 py-3 text-xs text-blue-600">{batch.replyCount}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(batch.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/dlr/pilot/${batch.id}`}
                      className="text-xs font-semibold text-indigo-600 hover:underline"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

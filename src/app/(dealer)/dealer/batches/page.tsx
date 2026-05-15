/**
 * /dealer/batches
 *
 * Dealer-facing batch list. Shows all pilot batches for the dealer's tenant,
 * ordered by created date desc. Each batch links to /dealer/batches/[batchId].
 */

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq, desc, inArray } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { pilotBatches, workflows } from '@/lib/db/schema'

const STATUS_STYLE: Record<string, { chip: string; label: string }> = {
  draft:     { chip: 'bg-gray-100 text-gray-600',      label: 'Draft' },
  approved:  { chip: 'bg-blue-100 text-blue-700',      label: 'Approved' },
  active:    { chip: 'bg-emerald-100 text-emerald-700', label: 'Active' },
  completed: { chip: 'bg-green-100 text-green-700',    label: 'Completed' },
  cancelled: { chip: 'bg-red-100 text-red-700',        label: 'Cancelled' },
}

const BUCKET_LABEL: Record<string, string> = {
  a: '14–29 days',
  b: '30–59 days',
  c: '60–89 days',
  d: '90+ days',
}

export default async function DealerBatchesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

  // Load all batches for this tenant
  const batches = await db.query.pilotBatches.findMany({
    where: (pb, { eq: eq_ }) => eq_(pb.tenantId, tenantId),
    with:  { leads: true },
    orderBy: (pb) => [desc(pb.createdAt)],
  })

  // Load workflow names
  const workflowIds = batches.map(b => b.workflowId).filter((id): id is string => !!id)
  const workflowRows = workflowIds.length > 0
    ? await db
        .select({ id: workflows.id, name: workflows.name, ageBucket: workflows.ageBucket })
        .from(workflows)
        .where(inArray(workflows.id, workflowIds))
    : []
  const workflowMap = new Map(workflowRows.map(w => [w.id, w]))

  const draftCount = batches.filter(b => b.status === 'draft').length

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Batches</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review message previews and approve pilot batches before anything is sent.
          </p>
        </div>
        <a
          href="/dealer/import"
          className="px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          + Import Leads
        </a>
      </div>

      {/* Pending review callout */}
      {draftCount > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-3.5 flex items-center gap-3">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
            {draftCount}
          </span>
          <div>
            <p className="text-sm font-semibold text-blue-900">
              {draftCount} batch{draftCount !== 1 ? 'es' : ''} waiting for your review
            </p>
            <p className="text-xs text-blue-700">
              No messages are sent until you review the previews and approve each batch.
            </p>
          </div>
        </div>
      )}

      {/* Batch list */}
      {batches.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-14 px-8 text-center">
          <p className="text-base font-semibold text-gray-700 mb-1">No batches yet</p>
          <p className="text-sm text-gray-500 max-w-sm mx-auto mb-5">
            Import leads and create a pilot batch to get started.
          </p>
          <a
            href="/dealer/import"
            className="px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 transition-colors"
          >
            Import Leads →
          </a>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
            <p className="text-sm font-semibold text-gray-900">
              All Batches ({batches.length})
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {batches.map(batch => {
              const wf     = batch.workflowId ? workflowMap.get(batch.workflowId) : null
              const bucket = wf?.ageBucket ?? null
              const style  = STATUS_STYLE[batch.status] ?? { chip: 'bg-gray-100 text-gray-600', label: batch.status }

              return (
                <div key={batch.id} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {wf?.name ?? 'Unknown workflow'}
                      </p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${style.chip}`}>
                        {style.label}
                      </span>
                      {batch.isFirstPilot && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
                          First Pilot
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {bucket ? `${BUCKET_LABEL[bucket]} · ` : ''}
                      {batch.leads.length} lead{batch.leads.length !== 1 ? 's' : ''}
                      {' · '}
                      Created {new Date(batch.createdAt).toLocaleDateString()}
                    </p>
                    {batch.approvedAt && (
                      <p className="text-xs text-emerald-600 mt-0.5">
                        Approved {new Date(batch.approvedAt).toLocaleDateString()}
                        {batch.approvedBy ? ` by ${batch.approvedBy}` : ''}
                      </p>
                    )}
                  </div>
                  <a
                    href={`/dealer/batches/${batch.id}`}
                    className={`flex-shrink-0 px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
                      batch.status === 'draft'
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    {batch.status === 'draft' ? 'Review →' : 'View →'}
                  </a>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

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

// Mirrors AGE_BUCKET_LABELS from schema.ts. Kept inline because this page
// renders a simple string lookup against workflow.ageBucket. Aligned to
// the actual classifier range so it matches the workflow name shown to
// the dealer ("14–29 Day Re-engagement", etc.) — no more "where did the
// 0–13 day leads go?" confusion.
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

  // Action-first layout: drafts that the dealer must approve get their own
  // section at the top with a prominent CTA. Everything else (approved,
  // active, completed, cancelled) is pushed below into a compact list so
  // older history doesn't drown out the work that needs doing.
  // 'draft' is the only status the per-batch DealerBatchChecklist exposes
  // controls for — including 'previewed' here would mislead the dealer.
  const reviewBatches = batches.filter(b => b.status === 'draft')
  const otherBatches  = batches.filter(b => b.status !== 'draft')

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-5 md:space-y-6">

      {/* Header — secondary 'Upload more leads' link, not a big black button */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Your Batches</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review message previews and approve pilot batches before anything is sent.
          </p>
        </div>
        <a
          href="/dealer/import"
          className="flex-shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap"
        >
          Upload more leads →
        </a>
      </div>

      {/* Empty state */}
      {batches.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-12 px-6 text-center">
          <p className="text-base font-semibold text-gray-700 mb-1">No batches yet</p>
          <p className="text-sm text-gray-500 max-w-sm mx-auto mb-5">
            Upload leads from the dealer dashboard to create your first pilot batch.
          </p>
          <a
            href="/dealer/import"
            className="inline-block px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 transition-colors"
          >
            Upload Dead Leads →
          </a>
        </div>
      )}

      {/* Needs your review */}
      {reviewBatches.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900">
            Needs your review ({reviewBatches.length})
          </h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">
            No messages are sent until you review the previews and approve each batch.
          </p>
          <ul className="space-y-3">
            {reviewBatches.map(batch => {
              const wf     = batch.workflowId ? workflowMap.get(batch.workflowId) : null
              const bucket = wf?.ageBucket ?? null

              return (
                <li
                  key={batch.id}
                  className="bg-white border-2 border-blue-200 rounded-xl p-4 shadow-sm"
                >
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {wf?.name ?? 'Unknown workflow'}
                    </p>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600">
                      Draft
                    </span>
                    {batch.isFirstPilot && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
                        First Pilot
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    {bucket ? `${BUCKET_LABEL[bucket]} · ` : ''}
                    {batch.leads.length} lead{batch.leads.length !== 1 ? 's' : ''}
                  </p>
                  <a
                    href={`/dealer/batches/${batch.id}`}
                    className="block w-full text-center px-4 py-2.5 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Review Batch →
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* All batches (everything not in 'draft') */}
      {otherBatches.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 md:px-5 py-2.5 border-b border-gray-200">
            <p className="text-sm font-semibold text-gray-900">
              All Batches ({otherBatches.length})
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {otherBatches.map(batch => {
              const wf     = batch.workflowId ? workflowMap.get(batch.workflowId) : null
              const bucket = wf?.ageBucket ?? null
              const style  = STATUS_STYLE[batch.status] ?? { chip: 'bg-gray-100 text-gray-600', label: batch.status }

              // Status-aware report-link label. Reports are only useful once the
              // batch has data (sending/paused/completed). Approved batches
              // haven't generated anything yet, and cancelled batches have no
              // meaningful outcome to summarise.
              const reportLabel =
                batch.status === 'completed' ? 'View Results' :
                batch.status === 'sending' || batch.status === 'paused' ? 'View Status' :
                null

              return (
                <li key={batch.id} className="px-4 md:px-5 py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
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
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    <a
                      href={`/dealer/batches/${batch.id}`}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                    >
                      View →
                    </a>
                    {reportLabel && (
                      <a
                        href={`/dealer/campaigns/${batch.id}/report`}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                      >
                        {reportLabel} →
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

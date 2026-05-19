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

// Dealer-facing campaign buckets. The dealer never sees the internal
// "14–29 days" / "30–59 days" boundaries — they see rounded campaign
// names that map 1:1 to the internal ageBucket values. Presentation-only:
// the underlying workflows still classify on the exact boundaries.
type CampaignBucketKey = 'a' | 'b' | 'c' | 'd'

const CAMPAIGN_BUCKETS: Array<{
  key:         CampaignBucketKey
  label:       string
  description: string
  recommended: boolean
}> = [
  { key: 'a', label: '14–30 Day Follow-Up', description: 'Recently quiet leads — a short re-engagement window.',  recommended: false },
  { key: 'b', label: '31–60 Day Follow-Up', description: 'Cooling leads — a gentle nudge back to the dealership.', recommended: false },
  { key: 'c', label: '61–90 Day Revival',   description: 'Aging leads — the sweet spot for a first pilot.',        recommended: true  },
  { key: 'd', label: '91+ Day Revival',     description: 'Long-cold leads — last-chance outreach.',                recommended: false },
]

// Dealer-facing status word for a featured batch in a campaign card.
const DEALER_STATUS_LABEL: Record<string, string> = {
  draft:     'Ready to review',
  approved:  'Approved',
  sending:   'Sending',
  active:    'Sending',
  paused:    'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
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

  // Group batches by their workflow's internal ageBucket (a/b/c/d). The
  // dealer never sees the raw bucket — each is presented as a campaign card
  // with a friendly label. Within a bucket, prefer the most-recent draft as
  // the featured batch (that's what needs review); otherwise the most-recent
  // non-draft. The query already orders by createdAt desc.
  const batchesByBucket: Record<CampaignBucketKey, typeof batches> = {
    a: [], b: [], c: [], d: [],
  }
  for (const b of batches) {
    const bucket = b.workflowId ? workflowMap.get(b.workflowId)?.ageBucket : null
    if (bucket === 'a' || bucket === 'b' || bucket === 'c' || bucket === 'd') {
      batchesByBucket[bucket].push(b)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-5 md:space-y-6">

      {/* Header — secondary 'Upload more leads' link, not a big black button */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Recommended Campaigns</h1>
          <p className="mt-1 text-sm text-gray-500">
            DLR groups your uploaded leads into ready-to-review campaigns.
            Review the message previews before anything is sent.
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
          <p className="text-base font-semibold text-gray-700 mb-1">No campaigns yet</p>
          <p className="text-sm text-gray-500 max-w-sm mx-auto mb-5">
            Upload leads from the dealer dashboard and DLR will prepare ready-to-review campaigns.
          </p>
          <a
            href="/dealer/import"
            className="inline-block px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 transition-colors"
          >
            Upload Dead Leads →
          </a>
        </div>
      )}

      {/* Campaign bucket cards (always 4) */}
      {batches.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {CAMPAIGN_BUCKETS.map(bucket => {
            const bucketBatches = batchesByBucket[bucket.key]
            const draftBatch    = bucketBatches.find(b => b.status === 'draft') ?? null
            const otherBatch    = bucketBatches.find(b => b.status !== 'draft') ?? null
            const featured      = draftBatch ?? otherBatch ?? null

            const statusLabel =
              !featured                       ? 'No leads yet' :
              DEALER_STATUS_LABEL[featured.status] ?? featured.status

            const ctaLabel =
              draftBatch ? 'Review Campaign →' :
              otherBatch ? 'View Campaign →'   :
              null

            const totalLeads = bucketBatches.reduce((n, b) => n + b.leads.length, 0)

            return (
              <article
                key={bucket.key}
                className={`bg-white rounded-xl p-4 shadow-sm flex flex-col gap-3 ${
                  draftBatch       ? 'border-2 border-blue-200' :
                  bucket.recommended ? 'border-2 border-purple-200' :
                  'border border-gray-200'
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="text-sm font-semibold text-gray-900">{bucket.label}</h3>
                    {bucket.recommended && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700 whitespace-nowrap">
                        Recommended first pilot
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {bucket.description}
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">
                    {totalLeads > 0
                      ? `${totalLeads} lead${totalLeads === 1 ? '' : 's'}`
                      : 'No leads selected'}
                  </span>
                  <span className={`font-semibold ${
                    draftBatch ? 'text-blue-700' :
                    otherBatch ? 'text-gray-700' :
                                 'text-gray-400'
                  }`}>
                    {statusLabel}
                  </span>
                </div>

                {featured && ctaLabel ? (
                  <a
                    href={`/dealer/batches/${featured.id}`}
                    className={`block w-full text-center px-4 py-2 text-sm font-bold rounded-lg transition-colors ${
                      draftBatch
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    {ctaLabel}
                  </a>
                ) : (
                  <div className="w-full text-center px-4 py-2 text-sm font-medium rounded-lg bg-gray-50 text-gray-500 border border-dashed border-gray-200">
                    {bucket.recommended
                      ? 'Upload leads here to start your first pilot'
                      : `Upload leads in this age window to use this campaign`}
                  </div>
                )}
              </article>
            )
          })}
        </section>
      )}

      {/* Campaign history — every batch, compact list, demoted below the cards */}
      {batches.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 md:px-5 py-2.5 border-b border-gray-200">
            <p className="text-sm font-semibold text-gray-900">
              Campaign history ({batches.length})
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              These are prepared previews and review history. Nothing here
              means messages were sent unless marked live or completed.
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {batches.map(batch => {
              const wf     = batch.workflowId ? workflowMap.get(batch.workflowId) : null
              const bucket = wf?.ageBucket ?? null
              const style  = STATUS_STYLE[batch.status] ?? { chip: 'bg-gray-100 text-gray-600', label: batch.status }

              // Status-aware report-link label. Reports are only useful once
              // the batch has data — draft/previewed/approved haven't sent yet.
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

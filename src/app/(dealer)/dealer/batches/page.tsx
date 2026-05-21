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

// Dealer-facing send-state map used in the Campaign history list. Each
// row pairs a chip color with a plain-English label so the dealer can
// see at a glance whether a campaign has actually sent messages.
//
//   - Draft / Preview only         (no sends)
//   - Approved — not sending yet   (no sends)
//   - Live / Sending               (real sends happening)
//   - Paused                       (sent some, paused)
//   - Completed                    (sent all)
//   - Cancelled                    (could be pre-send or post-send;
//                                   helper line uses liveSendCount to
//                                   decide honestly)
//
// The chip color comes from the row's `status`; the helper / counts
// underneath the row come from `liveSendCount` so we never claim "no
// messages sent" for a batch that actually fired before cancellation.
type DealerBatchStatusInfo = { chip: string; label: string }

const DEALER_BATCH_STATUS: Record<string, DealerBatchStatusInfo> = {
  draft:     { chip: 'bg-gray-100 text-gray-600',       label: 'Draft / Preview only' },
  // 'previewed' is an internal pipeline state that landed as a raw
  // lowercase chip in dealer QA — confusing because dealers couldn't
  // tell who did the previewing or whether it had sent. Surfaces as
  // "Preview only" (same gray treatment as draft); the "No messages
  // have been sent" helper row below it does the rest of the work.
  previewed: { chip: 'bg-gray-100 text-gray-600',       label: 'Preview only' },
  approved:  { chip: 'bg-blue-100 text-blue-700',       label: 'Approved — not sending yet' },
  sending:   { chip: 'bg-emerald-100 text-emerald-700', label: 'Live / Sending' },
  active:    { chip: 'bg-emerald-100 text-emerald-700', label: 'Live / Sending' },
  paused:    { chip: 'bg-amber-100 text-amber-700',     label: 'Paused' },
  completed: { chip: 'bg-green-100 text-green-700',     label: 'Completed' },
  cancelled: { chip: 'bg-red-100 text-red-700',         label: 'Cancelled' },
}

// Dealer-facing legend explaining what each status chip actually means.
// Surfaces beneath the bucket cards so a first-time dealer can decode the
// chips without asking. Order matches the lifecycle (preview → approved →
// live).
const STATUS_LEGEND: Array<{ label: string; chip: string; meaning: string }> = [
  { label: 'Preview only',
    chip:  'bg-gray-100 text-gray-600',
    meaning: 'Draft campaign, not ready for approval yet.' },
  { label: 'Ready for review',
    chip:  'bg-blue-100 text-blue-700',
    meaning: 'Review messages before approval.' },
  { label: 'Approved — not sending yet',
    chip:  'bg-blue-100 text-blue-700',
    meaning: 'Approved by you; still paused until final launch.' },
  { label: 'Live / Sending',
    chip:  'bg-emerald-100 text-emerald-700',
    meaning: 'Messages are going out to your leads.' },
]

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
  { key: 'c', label: '61–90 Day Revival',   description: 'Aging leads — the best place to start.',                recommended: true  },
  { key: 'd', label: '91+ Day Revival',     description: 'Long-cold leads — last-chance outreach.',                recommended: false },
]

// Dealer-facing status word for a featured batch in a campaign card.
// Short form (single word/phrase) for the space-constrained bucket
// cards — the Campaign history list below uses the longer dealer
// labels from DEALER_BATCH_STATUS.
const DEALER_STATUS_LABEL: Record<string, string> = {
  draft:     'Ready for your review',
  // 'previewed' is an internal pipeline state. Without an entry here
  // the bucket card's fallback renders the raw lowercase status, which
  // QA flagged as confusing ("did DLR preview it? did I? was it sent?").
  // Mirrors the Preview only mapping used by the Campaign history map
  // below so both surfaces speak the same dealer-facing language.
  previewed: 'Preview only',
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
  const batchesRaw = await db.query.pilotBatches.findMany({
    where: (pb, { eq: eq_ }) => eq_(pb.tenantId, tenantId),
    with:  { leads: { with: { lead: { columns: { isTest: true } } } } },
    orderBy: (pb) => [desc(pb.createdAt)],
  })

  // Dealer-only filter: drop pilot_batch_leads rows whose linked lead is
  // flagged is_test=true. Demo-data hygiene only — the batch itself stays
  // (admin can still see it), and downstream code that reads batch.leads
  // sees only the production-visible lead set.
  const batches = batchesRaw.map(b => ({
    ...b,
    leads: b.leads.filter(bl => !bl.lead?.isTest),
  }))

  // Campaign-history list excludes unsent draft/previewed rows — internal
  // pipeline states that clutter the dealer view with prep-stage noise.
  // The bucket cards above still surface the current draft for review.
  const historyBatches = batches.filter(b =>
    !(b.liveSendCount === 0 && (b.status === 'draft' || b.status === 'previewed' || b.status === 'approved')),
  )

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
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Campaigns</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your uploaded leads are grouped into ready-to-review campaigns.
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

      {/* Status legend — quick decoder for the chips below so a
          first-time dealer never has to guess what "Preview only" or
          "Approved — not sending yet" mean. Suppressed in the empty
          state (no chips to decode there). */}
      {batches.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Campaign statuses
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
            {STATUS_LEGEND.map((row) => (
              <li key={row.label} className="flex items-start gap-2 text-xs text-gray-600">
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full font-bold ${row.chip}`}>
                  {row.label}
                </span>
                <span className="leading-relaxed">{row.meaning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
            Upload Leads →
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

            // The card's CTA opens a single batch (featured), so the count
            // shown on the card must match that batch's visible-lead count
            // — not the bucket-wide aggregate, which previously caused the
            // card to read "7 leads" while the review page only showed 1.
            // `featured.leads` is already filtered to non-test leads upstream.
            const featuredLeadCount = featured?.leads.length ?? 0
            const featuredIsEmpty   = featured !== null && featuredLeadCount === 0

            // Suppress the "Start here" badge AND the urgent draft styling
            // when the featured batch has zero eligible visible leads —
            // clicking through would only show the empty-state on the
            // review page, which makes the badge a trap during a demo.
            const showStartHere   = bucket.recommended && !featuredIsEmpty
            const isUrgentDraft   = draftBatch !== null && !featuredIsEmpty

            const statusLabel =
              !featured       ? 'No leads yet'       :
              featuredIsEmpty ? 'No eligible leads'  :
              DEALER_STATUS_LABEL[featured.status] ?? featured.status

            // CTA states:
            //   urgent_draft → big blue "Review Campaign"
            //   view         → gray "View Campaign" for non-draft batches
            //   empty        → muted "No eligible leads yet" (still
            //                  linked to the batch so a curious dealer
            //                  can see the empty review page, but
            //                  non-primary styling avoids drawing the
            //                  demo toward a dead campaign)
            //   no_featured  → dashed upload-prompt empty state
            const ctaState: 'urgent_draft' | 'view' | 'empty' | 'no_featured' =
              !featured        ? 'no_featured'  :
              featuredIsEmpty  ? 'empty'        :
              draftBatch       ? 'urgent_draft' :
                                 'view'

            return (
              <article
                key={bucket.key}
                className={`bg-white rounded-xl p-4 shadow-sm flex flex-col gap-3 ${
                  isUrgentDraft       ? 'border-2 border-blue-200' :
                  showStartHere       ? 'border-2 border-purple-200' :
                  'border border-gray-200'
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="text-sm font-semibold text-gray-900">{bucket.label}</h3>
                    {showStartHere && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700 whitespace-nowrap">
                        Start here
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {bucket.description}
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">
                    {featuredLeadCount > 0
                      ? `${featuredLeadCount} lead${featuredLeadCount === 1 ? '' : 's'}`
                      : 'No leads selected'}
                  </span>
                  <span className={`font-semibold ${
                    isUrgentDraft ? 'text-blue-700'  :
                    featured      ? 'text-gray-700' :
                                    'text-gray-400'
                  }`}>
                    {statusLabel}
                  </span>
                </div>

                {ctaState === 'urgent_draft' && featured && (
                  <a
                    href={`/dealer/batches/${featured.id}`}
                    className="block w-full text-center px-4 py-2 text-sm font-bold rounded-lg transition-colors bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Review Campaign →
                  </a>
                )}
                {ctaState === 'view' && featured && (
                  <a
                    href={`/dealer/batches/${featured.id}`}
                    className="block w-full text-center px-4 py-2 text-sm font-bold rounded-lg transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    View Campaign →
                  </a>
                )}
                {ctaState === 'empty' && featured && (
                  <a
                    href={`/dealer/batches/${featured.id}`}
                    className="block w-full text-center px-4 py-2 text-sm font-medium rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 border border-dashed border-gray-200"
                  >
                    No eligible leads yet
                  </a>
                )}
                {ctaState === 'no_featured' && (
                  <div className="w-full text-center px-4 py-2 text-sm font-medium rounded-lg bg-gray-50 text-gray-500 border border-dashed border-gray-200">
                    {bucket.recommended
                      ? 'Upload leads here to start your first campaign'
                      : `Upload leads in this age window to use this campaign`}
                  </div>
                )}
              </article>
            )
          })}
        </section>
      )}

      {/* Campaign history — every batch, compact list, demoted below the cards */}
      {historyBatches.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 md:px-5 py-2.5 border-b border-gray-200">
            <p className="text-sm font-semibold text-gray-900">
              Campaign history ({historyBatches.length})
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Only campaigns marked Live, Sending, or Completed have sent messages.
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {historyBatches.map(batch => {
              const wf     = batch.workflowId ? workflowMap.get(batch.workflowId) : null
              const bucket = wf?.ageBucket ?? null
              const info   = DEALER_BATCH_STATUS[batch.status] ?? {
                chip:  'bg-gray-100 text-gray-600',
                label: batch.status,
              }

              // Honest helper / counts split — we look at liveSendCount,
              // not status alone. A cancelled batch that fired some
              // messages before cancellation should NOT say "no messages
              // sent"; it should show its counts.
              const hasSends = batch.liveSendCount > 0
              const noSendHelper = !hasSends
                ? 'No messages have been sent from this campaign.'
                : null

              // Status-aware report-link label. Reports are only useful once
              // the batch has data — draft/previewed/approved haven't sent yet.
              const reportLabel =
                batch.status === 'completed' ? 'View Results' :
                batch.status === 'sending' || batch.status === 'paused' ? 'View Status' :
                null

              return (
                <li key={batch.id} className="px-4 md:px-5 py-3.5 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {wf?.name ?? 'Unknown workflow'}
                      </p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${info.chip}`}>
                        {info.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {bucket ? `${BUCKET_LABEL[bucket]} · ` : ''}
                      {batch.leads.length} lead{batch.leads.length !== 1 ? 's' : ''}
                      {' · '}
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </p>
                    {/* Honest sent-state communication: when the batch
                        has actually fired messages, show the counts the
                        DB already tracks. Otherwise show the "no
                        messages sent" reassurance. We never fake an
                        opt-out count — the batch row doesn't store one,
                        so we just don't show that column. */}
                    {hasSends ? (
                      <p className="text-xs text-gray-600">
                        <strong className="font-semibold text-gray-800">
                          {batch.liveSendCount}
                        </strong>{' '}
                        sent
                        {' · '}
                        <strong className="font-semibold text-gray-800">
                          {batch.replyCount}
                        </strong>{' '}
                        repl{batch.replyCount === 1 ? 'y' : 'ies'}
                        {' · '}
                        <strong className="font-semibold text-gray-800">
                          {batch.handoffCount}
                        </strong>{' '}
                        handoff{batch.handoffCount === 1 ? '' : 's'}
                      </p>
                    ) : noSendHelper ? (
                      <p className="text-xs text-gray-500 italic">{noSendHelper}</p>
                    ) : null}
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

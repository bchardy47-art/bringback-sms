/**
 * /dealer/batches/[batchId]
 *
 * Dealer-facing batch review page. Mirrors the admin batch review page but:
 *  - Scoped to session.user.tenantId (no cross-tenant access)
 *  - Uses DealerBatchChecklist with an approve server action
 *  - Language is dealer-centric ("your batch", not "this tenant")
 *  - Back link goes to /dealer/batches
 */

import { db } from '@/lib/db'
import { pilotBatches, pilotBatchLeads, leads, workflows } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import type { PilotPreviewMessage } from '@/lib/db/schema'
import { DealerBatchChecklist } from './DealerBatchChecklist'
import { DEALER_BUCKET_LABEL } from '@/lib/pilot/age-classification'
import type { AgeBucket } from '@/lib/db/schema'

type RouteContext = { params: { batchId: string } }

// Per-lead consent pill (used in the message-preview hero cards next to
// the lead's name). Mirrors the chip palette used in the small meta strip
// and on /dealer/batches so the same word always wears the same color.
const CONSENT_PILL: Record<string, string> = {
  explicit: 'bg-emerald-100 text-emerald-700',
  implied:  'bg-amber-100 text-amber-700',
  unknown:  'bg-gray-100 text-gray-600',
  revoked:  'bg-red-100 text-red-700',
}

export default async function DealerBatchReviewPage({ params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

  // Load batch — scoped to dealer's tenantId for security
  const batch = await db.query.pilotBatches.findFirst({
    where: and(
      eq(pilotBatches.id, params.batchId),
      eq(pilotBatches.tenantId, tenantId),
    ),
  })
  if (!batch) notFound()

  const [workflow, batchLeadRowsRaw] = await Promise.all([
    db.query.workflows.findFirst({ where: eq(workflows.id, batch.workflowId ?? '') }),
    db
      .select()
      .from(pilotBatchLeads)
      .where(eq(pilotBatchLeads.batchId, params.batchId)),
  ])

  // Load lead records
  const allLeadIds = batchLeadRowsRaw.map(r => r.leadId)
  const leadRecordsRaw = allLeadIds.length > 0
    ? await Promise.all(
        allLeadIds.map(id => db.query.leads.findFirst({ where: eq(leads.id, id) }))
      ).then(all => all.filter((l): l is NonNullable<typeof l> => !!l))
    : []

  // Dealer-only filter: drop leads flagged is_test=true and the
  // pilot_batch_leads rows that reference them. Mirrors the filter applied
  // on /dealer/batches so a card whose leads are all test fixtures looks
  // consistent everywhere. Admin views are unaffected.
  const leadRecords = leadRecordsRaw.filter(l => !l.isTest)
  const visibleLeadIds = new Set(leadRecords.map(l => l.id))
  const batchLeadRows = batchLeadRowsRaw.filter(r => visibleLeadIds.has(r.leadId))

  const leadMap = new Map(leadRecords.map(l => [l.id, l]))

  // Consent summary
  const consentCounts: Record<string, number> = {}
  for (const lead of leadRecords) {
    const c = lead.consentStatus ?? 'unknown'
    consentCounts[c] = (consentCounts[c] ?? 0) + 1
  }

  const isDraft    = batch.status === 'draft'
  const isApproved = batch.status === 'approved'
  const totalLeads = batchLeadRows.length
  const hasVisibleLeads = totalLeads > 0

  let fallbackCount = 0
  for (const bl of batchLeadRows) {
    const previews = (bl.previewMessages as PilotPreviewMessage[] | null) ?? []
    if (previews.some(p => p.usedFallback)) fallbackCount++
  }

  // Hero headline picks a name when there's a single lead; otherwise the
  // count. Falls back to "1 lead" if the single lead has no name on file —
  // never renders "Prepared messages for —".
  const singleLead = totalLeads === 1 ? leadRecords[0] : null
  const singleLeadFullName = singleLead
    ? `${singleLead.firstName ?? ''} ${singleLead.lastName ?? ''}`.trim()
    : ''
  const heroHeadline = singleLead && singleLeadFullName
    ? `Prepared messages for ${singleLeadFullName}`
    : `Prepared messages for ${totalLeads} lead${totalLeads === 1 ? '' : 's'}`

  const groupLabel = workflow?.ageBucket
    ? (DEALER_BUCKET_LABEL[workflow.ageBucket as AgeBucket] ?? workflow.name ?? '—')
    : (workflow?.name ?? '—')

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">

      {/* ── Header — dealer-friendly framing. Title + subtitle lead with the
            promise (read the exact messages) rather than the compliance frame
            ("Campaign Review"). Safety language stays inline so it can't be
            missed even when the checklist is collapsed below. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Review prepared messages</h1>
          <p className="mt-1.5 text-sm text-gray-600 leading-relaxed max-w-2xl">
            Read the exact messages before anything sends. Approval only prepares
            the campaign for final launch with DLR.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Report link — appears once the batch has data to summarise. */}
          {(batch.status === 'completed' ||
            batch.status === 'sending'  ||
            batch.status === 'paused') && (
            <a
              href={`/dealer/campaigns/${params.batchId}/report`}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
            >
              {batch.status === 'completed' ? 'View Results' : 'View Status'} →
            </a>
          )}
          <a
            href="/dealer/batches"
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-600"
          >
            ← All Campaigns
          </a>
        </div>
      </div>

      {/* Already approved banner */}
      {isApproved && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm font-semibold text-emerald-900">
            ✓ You approved this campaign
            {batch.approvedAt ? ` on ${new Date(batch.approvedAt).toLocaleDateString()}` : ''}.
          </p>
          <p className="text-xs text-emerald-700 mt-0.5">
            Our team will complete carrier verification before any messages are sent. We&apos;ll be in touch.
          </p>
        </div>
      )}

      {/* ── Compact meta strip — was a bordered batch-summary card + a
            separate Consent Summary card. Both collapsed here so the
            metadata stops competing with the message hero below. Group,
            lead count, created date, approval date, consent breakdown,
            and fallback count all live in one wrap-line. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className={`px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${
          isDraft    ? 'bg-blue-100 text-blue-700'    :
          isApproved ? 'bg-blue-100 text-blue-700'    :
          'bg-emerald-100 text-emerald-700'
        }`}>
          {isDraft ? 'Ready for review' : batch.status}
        </span>
        <span className="text-gray-500">
          <span className="text-gray-400">Group:</span>{' '}
          <span className="font-semibold text-gray-700">{groupLabel}</span>
        </span>
        <span className="text-gray-300" aria-hidden="true">·</span>
        <span className="text-gray-500">
          <span className="font-semibold text-gray-700">{totalLeads}</span>{' '}
          lead{totalLeads !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-300" aria-hidden="true">·</span>
        <span className="text-gray-500">
          <span className="text-gray-400">Created:</span>{' '}
          <span className="font-semibold text-gray-700">
            {new Date(batch.createdAt).toLocaleDateString()}
          </span>
        </span>
        {batch.approvedAt && (
          <>
            <span className="text-gray-300" aria-hidden="true">·</span>
            <span className="text-gray-500">
              <span className="text-gray-400">Approved:</span>{' '}
              <span className="font-semibold text-gray-700">
                {new Date(batch.approvedAt).toLocaleDateString()}
                {batch.approvedBy ? ` by ${batch.approvedBy}` : ''}
              </span>
            </span>
          </>
        )}
        {Object.entries(consentCounts).map(([status, count]) => (
          <span
            key={status}
            className={`px-2 py-0.5 rounded-full font-semibold ${
              CONSENT_PILL[status] ?? 'bg-gray-100 text-gray-600'
            }`}
          >
            {count} {status}
          </span>
        ))}
        {fallbackCount > 0 && (
          <span className="px-2 py-0.5 rounded-full font-semibold bg-orange-50 text-orange-700 border border-orange-200">
            {fallbackCount} fallback
          </span>
        )}
      </div>

      {!hasVisibleLeads && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl px-5 py-4">
          <p className="text-sm font-semibold text-amber-900">No eligible leads in this campaign yet.</p>
          <p className="text-xs text-amber-700 mt-1">
            Upload more leads in this age window and DLR will prepare them for review here.
          </p>
        </div>
      )}

      {hasVisibleLeads && (
        <section className="space-y-4">
          {/* ── Hero header — dealer-name-first headline + an inline
                emerald safety pill so "Nothing sends until you approve…"
                is still visible even when the approval checklist is
                collapsed below the messages. */}
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-lg md:text-xl font-bold text-gray-900 leading-tight">
                {heroHeadline}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                These are the exact messages each lead will receive, in order.
              </p>
            </div>
            <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 leading-snug">
              Nothing sends until you approve and complete the final launch step with DLR.
            </p>
          </div>

          {/* ── Per-lead cards — the visual hero. Each lead is its own
                card: identity header, then a clean vertical stack of
                Message 1 / Message 2 / Message 3 with the message body
                rendered as the primary text. */}
          <div className="space-y-4">
            {batchLeadRows.map((bl, idx) => {
              const lead     = leadMap.get(bl.leadId)
              const previews = (bl.previewMessages as PilotPreviewMessage[] | null) ?? []
              const consentVal = lead?.consentStatus ?? 'unknown'
              const fullName = `${lead?.firstName ?? ''} ${lead?.lastName ?? ''}`.trim() || '—'

              return (
                <article
                  key={bl.id}
                  className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
                >
                  {/* Identity header */}
                  <header className="px-5 py-4 bg-gradient-to-br from-gray-50 to-white border-b border-gray-100">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base md:text-lg font-bold text-gray-900 leading-tight">
                            {fullName}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              CONSENT_PILL[consentVal] ?? 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {consentVal} consent
                          </span>
                          {bl.approvedForSend && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                              ✓ Approved for send
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          {lead?.phone && (
                            <span className="font-mono text-gray-700">{lead.phone}</span>
                          )}
                          {lead?.vehicleOfInterest ? (
                            <span className="text-gray-600">{lead.vehicleOfInterest}</span>
                          ) : (
                            <span className="italic text-gray-400">No vehicle on file</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 mt-1 whitespace-nowrap">
                        Lead {idx + 1} of {totalLeads}
                      </span>
                    </div>
                  </header>

                  {/* Message stack */}
                  {previews.length > 0 ? (
                    <ol className="divide-y divide-gray-100">
                      {previews.map((p, i) => (
                        <li key={i} className="px-5 py-4">
                          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Message {i + 1}
                            </p>
                            <p className="text-xs text-gray-400">
                              {p.delayHours
                                ? `${p.delayHours >= 24
                                    ? `${Math.round(p.delayHours / 24)} day${Math.round(p.delayHours / 24) !== 1 ? 's' : ''}`
                                    : `${p.delayHours}h`} after previous`
                                : 'Sends first'}
                              {p.usedFallback && (
                                <span className="ml-2 text-amber-600 font-medium">
                                  ⚠ no vehicle on file
                                </span>
                              )}
                            </p>
                          </div>
                          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                            {p.rendered}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="px-5 py-4 text-xs text-gray-400 italic">
                      No message previews available for this lead.
                    </p>
                  )}
                </article>
              )
            })}
          </div>

          {/* ── Fallback-template note — moved out of the consent
                summary's main eye path. Closed by default so it never
                competes with the message preview hero above. Only shown
                when at least one preview is actually using a fallback. */}
          {fallbackCount > 0 && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer font-medium text-gray-500 hover:text-gray-700 list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1">
                <span>What does &ldquo;fallback&rdquo; mean?</span>
                <span aria-hidden="true">▾</span>
              </summary>
              <p className="mt-1.5 max-w-prose leading-relaxed">
                Fallback templates are used when a lead&apos;s vehicle of interest
                isn&apos;t on file — they&apos;re still personalized to first name and
                dealership.
              </p>
            </details>
          )}
        </section>
      )}

      {/* ── Approval checklist — wrapped in <details> so it reads as the
            final step after reviewing messages, not a compliance form
            that competes with the hero. The inner DealerBatchChecklist
            client component is mounted with its state preserved across
            open/close (native <details> just toggles visibility), so the
            existing checklist + attestation + server-action gating is
            entirely unchanged. */}
      {isDraft && hasVisibleLeads && (
        <details className="group rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                Ready to approve? Review safety checklist
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Final step — open this once the messages above look right to you.
              </p>
            </div>
            <span
              aria-hidden="true"
              className="text-gray-400 transition-transform duration-150 group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <div className="border-t border-gray-100">
            <DealerBatchChecklist
              batchId={params.batchId}
              totalLeads={totalLeads}
            />
          </div>
        </details>
      )}

      {/* Footer nav */}
      <div className="text-xs text-gray-400 space-x-3">
        <a href="/dealer/batches" className="text-blue-600 underline">← All Campaigns</a>
        <a href="/dealer/dashboard" className="text-blue-600 underline">Dashboard</a>
        <a href="/dealer/inbox" className="text-blue-600 underline">Inbox</a>
      </div>
    </div>
  )
}

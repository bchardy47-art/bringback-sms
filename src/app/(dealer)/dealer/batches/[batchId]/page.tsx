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
import { redirect, notFound } from 'next/navigation'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import type { PilotPreviewMessage } from '@/lib/db/schema'
import { DealerBatchChecklist } from './DealerBatchChecklist'
import { DEALER_BUCKET_LABEL } from '@/lib/pilot/age-classification'
import type { AgeBucket } from '@/lib/db/schema'

type RouteContext = { params: { batchId: string } }

// Per-lead consent pill (used in the message-preview hero cards next to
// the lead's name). Mirrors the chip palette used in the small meta strip
// and on /dealer/batches so the same word always wears the same color.
const CONSENT_PILL: Record<string, string> = {
  explicit: 'bg-[rgba(16,185,129,0.15)] text-emerald-400',
  implied:  'bg-[rgba(245,158,11,0.15)] text-amber-400',
  unknown:  'bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)]',
  revoked:  'bg-[rgba(255,27,27,0.15)] text-red-400',
}

export default async function DealerBatchReviewPage({ params }: RouteContext) {
  const session = await getDealerSession()
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
    <div className="dlr-app-bg min-h-full text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">

      {/* ── Header — dealer-friendly framing. Title + subtitle lead with the
            promise (read the exact messages) rather than the compliance frame
            ("Campaign Review"). Safety language stays inline so it can't be
            missed even when the checklist is collapsed below. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Campaign Review</p>
          <h1 className="text-2xl font-black text-white mt-1">Review prepared messages</h1>
          <p className="mt-1.5 text-sm leading-relaxed max-w-2xl" style={{ color: 'rgba(255,255,255,0.6)' }}>
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
              className="dlr-btn-primary"
              style={{ height: 32, padding: '0 12px', fontSize: 11 }}
            >
              {batch.status === 'completed' ? 'View Results' : 'View Status'} →
            </a>
          )}
          <a
            href="/dealer/batches"
            className="dlr-btn-secondary"
            style={{ height: 32, padding: '0 12px', fontSize: 11 }}
          >
            ← All Campaigns
          </a>
        </div>
      </div>

      {/* Already approved banner */}
      {isApproved && (
        <div
          className="rounded-xl px-5 py-4"
          style={{
            background: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.35)',
          }}
        >
          <p className="text-sm font-bold" style={{ color: '#34d399' }}>
            ✓ You approved this campaign
            {batch.approvedAt ? ` on ${new Date(batch.approvedAt).toLocaleDateString()}` : ''}.
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(52,211,153,0.8)' }}>
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
          isDraft    ? 'bg-[rgba(59,130,246,0.15)] text-blue-400'    :
          isApproved ? 'bg-[rgba(59,130,246,0.15)] text-blue-400'    :
          'bg-[rgba(16,185,129,0.15)] text-emerald-400'
        }`}>
          {isDraft ? 'Ready for review' : batch.status}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>Group:</span>{' '}
          <span className="font-semibold text-white">{groupLabel}</span>
        </span>
        <span style={{ color: 'rgba(255,255,255,0.2)' }} aria-hidden="true">·</span>
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>
          <span className="font-semibold text-white">{totalLeads}</span>{' '}
          lead{totalLeads !== 1 ? 's' : ''}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.2)' }} aria-hidden="true">·</span>
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>Created:</span>{' '}
          <span className="font-semibold text-white">
            {new Date(batch.createdAt).toLocaleDateString()}
          </span>
        </span>
        {batch.approvedAt && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.2)' }} aria-hidden="true">·</span>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>
              <span style={{ color: 'rgba(255,255,255,0.35)' }}>Approved:</span>{' '}
              <span className="font-semibold text-white">
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
              CONSENT_PILL[status] ?? 'bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)]'
            }`}
          >
            {count} {status}
          </span>
        ))}
        {fallbackCount > 0 && (
          <span
            className="px-2 py-0.5 rounded-full font-semibold"
            style={{
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.3)',
              color: '#fbbf24',
            }}
          >
            {fallbackCount} fallback
          </span>
        )}
      </div>

      {!hasVisibleLeads && (
        <div
          className="rounded-xl px-5 py-4"
          style={{
            background: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.35)',
          }}
        >
          <p className="text-sm font-bold" style={{ color: '#fbbf24' }}>No eligible leads in this campaign yet.</p>
          <p className="text-xs mt-1" style={{ color: 'rgba(251,191,36,0.8)' }}>
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
              <h2 className="text-lg md:text-xl font-black text-white leading-tight">
                {heroHeadline}
              </h2>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                These are the exact messages each lead will receive, in order.
              </p>
            </div>
            <p
              className="text-xs font-bold rounded-full px-3 py-1 leading-snug"
              style={{
                background: 'rgba(16,185,129,0.1)',
                border: '1px solid rgba(16,185,129,0.3)',
                color: '#34d399',
              }}
            >
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
                  className="dlr-card overflow-hidden"
                >
                  {/* Identity header */}
                  <header
                    className="px-5 py-4"
                    style={{
                      background: 'rgba(255,27,27,0.04)',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base md:text-lg font-bold text-white leading-tight">
                            {fullName}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              CONSENT_PILL[consentVal] ?? 'bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)]'
                            }`}
                          >
                            {consentVal} consent
                          </span>
                          {bl.approvedForSend && (
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399' }}
                            >
                              ✓ Approved for send
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          {lead?.phone && (
                            <span className="font-mono" style={{ color: 'rgba(255,255,255,0.7)' }}>{lead.phone}</span>
                          )}
                          {lead?.vehicleOfInterest ? (
                            <span style={{ color: 'rgba(255,255,255,0.6)' }}>{lead.vehicleOfInterest}</span>
                          ) : (
                            <span className="italic" style={{ color: 'rgba(255,255,255,0.3)' }}>No vehicle on file</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs mt-1 whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        Lead {idx + 1} of {totalLeads}
                      </span>
                    </div>
                  </header>

                  {/* Message stack */}
                  {previews.length > 0 ? (
                    <ol className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                      {previews.map((p, i) => (
                        <li key={i} className="px-5 py-4">
                          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#ff5252' }}>
                              Message {i + 1}
                            </p>
                            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                              {p.delayHours
                                ? `${p.delayHours >= 24
                                    ? `${Math.round(p.delayHours / 24)} day${Math.round(p.delayHours / 24) !== 1 ? 's' : ''}`
                                    : `${p.delayHours}h`} after previous`
                                : 'Sends first'}
                              {p.usedFallback && (
                                <span className="ml-2 font-medium" style={{ color: '#fbbf24' }}>
                                  ⚠ no vehicle on file
                                </span>
                              )}
                            </p>
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.85)' }}>
                            {p.rendered}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="px-5 py-4 text-xs italic" style={{ color: 'rgba(255,255,255,0.35)' }}>
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
            <details className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
              <summary
                className="cursor-pointer font-medium list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1"
                style={{ color: 'rgba(255,255,255,0.5)' }}
              >
                <span>What does &ldquo;fallback&rdquo; mean?</span>
                <span aria-hidden="true">▾</span>
              </summary>
              <p className="mt-1.5 max-w-prose leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
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
        <details
          className="group rounded-xl overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015)), rgba(12,12,14,0.88)',
            border: '1px solid rgba(255,27,27,0.35)',
          }}
        >
          <summary
            className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-3 transition-colors [&::-webkit-details-marker]:hidden"
            style={{ color: 'rgba(255,255,255,0.9)' }}
          >
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">
                Ready to approve? Review safety checklist
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Final step — open this once the messages above look right to you.
              </p>
            </div>
            <span
              aria-hidden="true"
              className="transition-transform duration-150 group-open:rotate-180"
              style={{ color: 'rgba(255,255,255,0.4)' }}
            >
              ▾
            </span>
          </summary>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <DealerBatchChecklist
              batchId={params.batchId}
              totalLeads={totalLeads}
            />
          </div>
        </details>
      )}

      {/* Footer nav */}
      <div className="text-xs space-x-3" style={{ color: 'rgba(255,255,255,0.35)' }}>
        <a href="/dealer/batches" style={{ color: '#ff5252' }}>← All Campaigns</a>
        <a href="/dealer/dashboard" style={{ color: '#ff5252' }}>Dashboard</a>
        <a href="/dealer/inbox" style={{ color: '#ff5252' }}>Inbox</a>
      </div>
      </div>
    </div>
  )
}

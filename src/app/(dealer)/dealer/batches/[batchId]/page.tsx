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

// Per-lead consent pill inline styles — dark equivalents of the old light
// Tailwind chip classes. Kept as a map so each reference is consistent.
const CONSENT_STYLE: Record<string, { bg: string; fg: string }> = {
  explicit: { bg: 'rgba(34,197,94,0.12)',   fg: '#4ade80'          },
  implied:  { bg: 'rgba(245,158,11,0.12)',  fg: '#fbbf24'          },
  unknown:  { bg: 'rgba(255,255,255,0.06)', fg: 'var(--tx-lo)'     },
  revoked:  { bg: 'rgba(255,42,42,0.12)',   fg: '#ff8a7a'          },
}

// Batch status → dealer-friendly label + dark badge colors (matches /dealer/batches list)
const STATUS_DISPLAY: Record<string, { label: string; bg: string; fg: string }> = {
  draft:     { label: 'Draft / Preview only',        bg: 'rgba(255,255,255,0.07)', fg: 'var(--tx-mid)'  },
  previewed: { label: 'Preview only',                bg: 'rgba(255,255,255,0.07)', fg: 'var(--tx-mid)'  },
  approved:  { label: 'Approved — not sending yet',  bg: 'rgba(34,197,94,0.12)',   fg: '#4ade80'         },
  sending:   { label: 'Sending',                     bg: 'rgba(255,42,42,0.12)',   fg: '#ff5252'         },
  completed: { label: 'Completed',                   bg: 'rgba(34,197,94,0.12)',   fg: '#4ade80'         },
  paused:    { label: 'Paused',                      bg: 'rgba(245,158,11,0.12)',  fg: '#fbbf24'         },
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
    const lead = leadMap.get(bl.leadId)
    const previews = (bl.previewMessages as PilotPreviewMessage[] | null) ?? []
    // P0 #2: only count as fallback if the lead still lacks vehicle data
    // (stored usedFallback may be stale if vehicle was added after preview ran)
    if (!lead?.vehicleOfInterest && previews.some(p => p.type === 'send_sms' && p.usedFallback)) {
      fallbackCount++
    }
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

  const statusEntry = STATUS_DISPLAY[batch.status] ?? { label: batch.status, bg: 'rgba(255,255,255,0.05)', fg: 'var(--tx-lo)' }

  return (
    <div
      className="p-4 md:p-8 max-w-4xl mx-auto space-y-6"
      style={{ color: 'var(--tx)', fontFamily: 'var(--f-body)' }}
    >

      {/* ── Header — dealer-friendly framing. Title + subtitle lead with the
            promise (read the exact messages) rather than the compliance frame
            ("Campaign Review"). Safety language stays inline so it can't be
            missed even when the checklist is collapsed below. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx-hi)', letterSpacing: '-0.015em', lineHeight: 1.15 }}>
            Review prepared messages
          </h1>
          <p style={{ marginTop: 6, fontSize: 14, color: 'var(--tx-mid)', lineHeight: 1.55, maxWidth: 560 }}>
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
              className="dlr-btn-secondary"
              style={{ height: 32, padding: '0 12px', fontSize: 12, textDecoration: 'none' }}
            >
              {batch.status === 'completed' ? 'View Results' : 'View Status'} →
            </a>
          )}
          <a
            href="/dealer/batches"
            className="dlr-btn-secondary"
            style={{ height: 32, padding: '0 12px', fontSize: 12, textDecoration: 'none' }}
          >
            ← All Campaigns
          </a>
        </div>
      </div>

      {/* Already approved banner */}
      {isApproved && (
        <div style={{
          borderRadius: 12,
          border: '1px solid rgba(34,197,94,0.3)',
          background: 'rgba(34,197,94,0.07)',
          padding: '14px 20px',
        }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#4ade80' }}>
            ✓ You approved this campaign
            {batch.approvedAt ? ` on ${new Date(batch.approvedAt).toLocaleDateString()}` : ''}.
          </p>
          <p style={{ fontSize: 12, color: 'rgba(74,222,128,0.75)', marginTop: 3 }}>
            Our team will complete carrier verification before any messages are sent. We&apos;ll be in touch.
          </p>
        </div>
      )}

      {/* ── Compact meta strip — group, lead count, dates, consent breakdown. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" style={{ fontSize: 12 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '2px 10px', borderRadius: 20,
          fontSize: 10, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
          background: statusEntry.bg, color: statusEntry.fg,
        }}>
          {statusEntry.label}
        </span>
        <span style={{ color: 'var(--tx-lo)' }}>
          <span style={{ color: 'var(--tx-lo)' }}>Group:</span>{' '}
          <span style={{ fontWeight: 600, color: 'var(--tx-mid)' }}>{groupLabel}</span>
        </span>
        <span style={{ color: 'var(--tx-lo)' }} aria-hidden="true">·</span>
        <span style={{ color: 'var(--tx-lo)' }}>
          <span style={{ fontWeight: 600, color: 'var(--tx-mid)' }}>{totalLeads}</span>{' '}
          lead{totalLeads !== 1 ? 's' : ''}
        </span>
        <span style={{ color: 'var(--tx-lo)' }} aria-hidden="true">·</span>
        <span style={{ color: 'var(--tx-lo)' }}>
          <span>Created:</span>{' '}
          <span style={{ fontWeight: 600, color: 'var(--tx-mid)' }}>
            {new Date(batch.createdAt).toLocaleDateString()}
          </span>
        </span>
        {batch.approvedAt && (
          <>
            <span style={{ color: 'var(--tx-lo)' }} aria-hidden="true">·</span>
            <span style={{ color: 'var(--tx-lo)' }}>
              <span>Approved:</span>{' '}
              <span style={{ fontWeight: 600, color: 'var(--tx-mid)' }}>
                {new Date(batch.approvedAt).toLocaleDateString()}
                {batch.approvedBy ? ` by ${batch.approvedBy}` : ''}
              </span>
            </span>
          </>
        )}
        {Object.entries(consentCounts).map(([status, count]) => {
          const cs = CONSENT_STYLE[status] ?? CONSENT_STYLE.unknown
          return (
            <span
              key={status}
              style={{
                padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                backgroundColor: cs.bg, color: cs.fg,
              }}
            >
              {count} {status}
            </span>
          )
        })}
        {fallbackCount > 0 && (
          <span style={{
            padding: '2px 8px', borderRadius: 20, fontWeight: 600,
            background: 'rgba(245,158,11,0.12)', color: '#fbbf24',
            border: '1px solid rgba(245,158,11,0.25)',
          }}>
            {fallbackCount} fallback
          </span>
        )}
      </div>

      {!hasVisibleLeads && (
        <div style={{
          borderRadius: 12,
          border: '1px solid rgba(245,158,11,0.35)',
          background: 'rgba(245,158,11,0.08)',
          padding: '16px 20px',
        }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#fbbf24' }}>
            No eligible leads in this campaign yet.
          </p>
          <p style={{ fontSize: 12, color: 'rgba(251,191,36,0.75)', marginTop: 4 }}>
            Upload more leads in this age window and DLR will prepare them for review here.
          </p>
        </div>
      )}

      {hasVisibleLeads && (
        <section className="space-y-4">
          {/* ── Hero header — dealer-name-first headline + an inline
                safety pill so "Nothing sends until you approve…"
                is still visible even when the approval checklist is
                collapsed below the messages. */}
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--tx-hi)', lineHeight: 1.25 }}>
                {heroHeadline}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--tx-lo)', marginTop: 3 }}>
                These are the exact messages each lead will receive, in order.
              </p>
            </div>
            <p style={{
              fontSize: 11, fontWeight: 700,
              color: '#4ade80',
              background: 'rgba(34,197,94,0.10)',
              border: '1px solid rgba(34,197,94,0.28)',
              borderRadius: 20,
              padding: '4px 12px',
              lineHeight: 1.5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}>
              Nothing sends until you approve and complete the final launch step with DLR.
            </p>
          </div>

          {/* ── Per-lead cards — the visual hero. Each lead is its own
                dark card: identity header, then a clean vertical stack of
                Message 1 / Message 2 / Message 3 with the message body
                rendered as the primary text. */}
          <div className="space-y-4">
            {batchLeadRows.map((bl, idx) => {
              const lead     = leadMap.get(bl.leadId)
              // P0 #3: render only actual SMS send steps — condition/assign/stop steps
              // have rendered=null and create blank message cards when included
              const previews = ((bl.previewMessages as PilotPreviewMessage[] | null) ?? [])
                .filter(p => p.type === 'send_sms')
              const consentVal = lead?.consentStatus ?? 'unknown'
              const cs         = CONSENT_STYLE[consentVal] ?? CONSENT_STYLE.unknown
              const fullName   = `${lead?.firstName ?? ''} ${lead?.lastName ?? ''}`.trim() || '—'

              return (
                <article
                  key={bl.id}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.09)',
                    borderRadius: 16,
                    overflow: 'hidden',
                  }}
                >
                  {/* Identity header */}
                  <header style={{
                    padding: '14px 20px',
                    background: 'rgba(255,255,255,0.035)',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                  }}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-hi)', lineHeight: 1.3 }}>
                            {fullName}
                          </h3>
                          <span
                            style={{
                              padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                              backgroundColor: cs.bg, color: cs.fg,
                            }}
                          >
                            {consentVal} consent
                          </span>
                          {bl.approvedForSend && (
                            /* P0 #1: use status-appropriate copy — "Approved for send"
                               is only accurate once the dealer has actually approved the
                               batch; in draft/previewed state it contradicts the safety
                               copy ("nothing sends until you approve…"). */
                            isDraft || batch.status === 'previewed' ? (
                              <span style={{
                                padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                                background: 'rgba(255,255,255,0.07)', color: 'var(--tx-mid)',
                              }}>
                                Cleared for review
                              </span>
                            ) : (
                              <span style={{
                                padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                                background: 'rgba(34,197,94,0.12)', color: '#4ade80',
                              }}>
                                ✓ Approved for send
                              </span>
                            )
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5" style={{ fontSize: 12 }}>
                          {lead?.phone && (
                            <span style={{ fontFamily: 'monospace', color: 'var(--tx-mid)' }}>
                              {lead.phone}
                            </span>
                          )}
                          {lead?.vehicleOfInterest ? (
                            <span style={{ color: 'var(--tx-mid)' }}>{lead.vehicleOfInterest}</span>
                          ) : (
                            <span style={{ fontStyle: 'italic', color: 'var(--tx-lo)' }}>No vehicle on file</span>
                          )}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--tx-lo)', marginTop: 2, whiteSpace: 'nowrap' }}>
                        Lead {idx + 1} of {totalLeads}
                      </span>
                    </div>
                  </header>

                  {/* Message stack */}
                  {previews.length > 0 ? (
                    <ol>
                      {previews.map((p, i) => (
                        <li
                          key={i}
                          style={{
                            padding: '14px 20px',
                            borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : undefined,
                          }}
                        >
                          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--tx-lo)' }}>
                              Message {i + 1}
                            </p>
                            <p style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
                              {p.delayHours
                                ? `${p.delayHours >= 24
                                    ? `${Math.round(p.delayHours / 24)} day${Math.round(p.delayHours / 24) !== 1 ? 's' : ''}`
                                    : `${p.delayHours}h`} after previous`
                                : 'Sends first'}
                              {/* P0 #2: suppress stale fallback warning when the lead
                                  now has vehicle data — usedFallback may be cached from
                                  before the vehicle was added to the import record */}
                              {p.usedFallback && !lead?.vehicleOfInterest && (
                                <span style={{ marginLeft: 8, color: '#fbbf24', fontWeight: 600 }}>
                                  ⚠ no vehicle on file
                                </span>
                              )}
                            </p>
                          </div>
                          <p style={{ fontSize: 14, color: 'var(--tx)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                            {p.rendered}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p style={{ padding: '14px 20px', fontSize: 12, color: 'var(--tx-lo)', fontStyle: 'italic' }}>
                      No message previews available for this lead.
                    </p>
                  )}
                </article>
              )
            })}
          </div>

          {/* ── Fallback-template note — closed by default so it never
                competes with the message preview hero above. Only shown
                when at least one preview is actually using a fallback. */}
          {fallbackCount > 0 && (
            <details style={{ fontSize: 12, color: 'var(--tx-lo)' }}>
              <summary
                className="list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1"
                style={{ cursor: 'pointer', fontWeight: 500, color: 'var(--tx-lo)' }}
              >
                <span>What does &ldquo;fallback&rdquo; mean?</span>
                <span aria-hidden="true">▾</span>
              </summary>
              <p style={{ marginTop: 6, maxWidth: 520, lineHeight: 1.6, color: 'var(--tx-lo)' }}>
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
          className="group overflow-hidden"
          style={{
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.10)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <summary
            className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"
            style={{ borderRadius: 'inherit' }}
          >
            <div className="min-w-0">
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-hi)' }}>
                Ready to approve? Review safety checklist
              </p>
              <p style={{ fontSize: 12, color: 'var(--tx-lo)', marginTop: 2 }}>
                Final step — open this once the messages above look right to you.
              </p>
            </div>
            <span
              aria-hidden="true"
              className="transition-transform duration-150 group-open:rotate-180"
              style={{ color: 'var(--tx-lo)' }}
            >
              ▾
            </span>
          </summary>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <DealerBatchChecklist
              batchId={params.batchId}
              totalLeads={totalLeads}
            />
          </div>
        </details>
      )}

      {/* Footer nav */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--tx-lo)', marginTop: 8 }}>
        <a href="/dealer/batches"  className="link-red" style={{ fontSize: 12 }}>← All Campaigns</a>
        <a href="/dealer/dashboard" style={{ color: 'var(--tx-lo)', textDecoration: 'none' }}>Dashboard</a>
        <a href="/dealer/inbox"     style={{ color: 'var(--tx-lo)', textDecoration: 'none' }}>Inbox</a>
      </div>
    </div>
  )
}

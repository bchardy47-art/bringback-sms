/**
 * /dealer/batches
 *
 * Dealer-facing batch list. Shows all pilot batches for the dealer's tenant,
 * ordered by created date desc. Each batch links to /dealer/batches/[batchId].
 */

import { redirect } from 'next/navigation'
import { desc, inArray } from 'drizzle-orm'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import { db } from '@/lib/db'
import { pilotBatches, workflows } from '@/lib/db/schema'
import { DlrHeroArt } from '@/components/dealer/DlrHeroArt'
import { Eye, Users, Hourglass, Send, ArrowRight, Calendar } from 'lucide-react'
void pilotBatches

type DealerBatchStatusInfo = { chip: string; label: string }

const DEALER_BATCH_STATUS: Record<string, DealerBatchStatusInfo> = {
  draft:     { chip: 'dlr-badge-preview', label: 'Draft / Preview only' },
  previewed: { chip: 'dlr-badge-preview', label: 'Preview only' },
  approved:  { chip: 'dlr-badge-approved', label: 'Approved — not sending yet' },
  sending:   { chip: 'dlr-badge-sending',  label: 'Live / Sending' },
  active:    { chip: 'dlr-badge-sending',  label: 'Live / Sending' },
  paused:    { chip: 'dlr-badge-approved', label: 'Paused' },
  completed: { chip: 'dlr-badge-sending',  label: 'Completed' },
  cancelled: { chip: 'dlr-badge-live',     label: 'Cancelled' },
}

// Status legend that matches the spec's four-card row.
const STATUS_LEGEND = [
  {
    label:   'Preview only',
    meaning: 'Draft campaigns, not ready for approval yet.',
    Icon:    Eye,
    color:   'rgba(255,255,255,0.5)',
    glow:    'none',
    chip:    'dlr-badge-preview',
  },
  {
    label:   'Ready for review',
    meaning: 'Review messages before approval.',
    Icon:    Users,
    color:   '#ff5252',
    glow:    '0 0 18px rgba(255,27,27,0.35)',
    chip:    'dlr-badge-live',
  },
  {
    label:   'Approved — not sending yet',
    meaning: 'Approved by you, still paused until final launch.',
    Icon:    Hourglass,
    color:   '#fbbf24',
    glow:    '0 0 18px rgba(245,158,11,0.32)',
    chip:    'dlr-badge-approved',
  },
  {
    label:   'Live / Sending',
    meaning: 'Messages are going out to your leads.',
    Icon:    Send,
    color:   '#22c55e',
    glow:    '0 0 18px rgba(34,197,94,0.32)',
    chip:    'dlr-badge-sending',
  },
] as const

const BUCKET_LABEL: Record<string, string> = {
  a: '14–29 days',
  b: '30–59 days',
  c: '60–89 days',
  d: '90+ days',
}

type CampaignBucketKey = 'a' | 'b' | 'c' | 'd'

const CAMPAIGN_BUCKETS: Array<{
  key:         CampaignBucketKey
  label:       string
  description: string
  recommended: boolean
}> = [
  { key: 'a', label: '14–30 Day Follow-Up', description: 'Recently quiet leads — a short re-engagement window.',  recommended: false },
  { key: 'b', label: '31–60 Day Follow-Up', description: 'Cooling leads — a gentle nudge back to the dealership.', recommended: true  },
  { key: 'c', label: '61–90 Day Revival',   description: 'Aging leads — strong revival candidates.',              recommended: false },
  { key: 'd', label: '91+ Day Revival',     description: 'Long-cold leads — last-chance outreach.',                recommended: false },
]

const DEALER_STATUS_LABEL: Record<string, string> = {
  draft:     'Ready for your review',
  previewed: 'Preview only',
  approved:  'Approved',
  sending:   'Sending',
  active:    'Sending',
  paused:    'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export default async function DealerBatchesPage() {
  const session = await getDealerSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

  const batchesRaw = await db.query.pilotBatches.findMany({
    where: (pb, { eq: eq_ }) => eq_(pb.tenantId, tenantId),
    with:  { leads: { with: { lead: { columns: { isTest: true } } } } },
    orderBy: (pb) => [desc(pb.createdAt)],
  })

  const batches = batchesRaw.map(b => ({
    ...b,
    leads: b.leads.filter(bl => !bl.lead?.isTest),
  }))

  const historyBatches = batches.filter(b =>
    !(b.liveSendCount === 0 && (b.status === 'draft' || b.status === 'previewed' || b.status === 'approved')),
  )

  const workflowIds = batches.map(b => b.workflowId).filter((id): id is string => !!id)
  const workflowRows = workflowIds.length > 0
    ? await db
        .select({ id: workflows.id, name: workflows.name, ageBucket: workflows.ageBucket })
        .from(workflows)
        .where(inArray(workflows.id, workflowIds))
    : []
  const workflowMap = new Map(workflowRows.map(w => [w.id, w]))

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
    <div className="dlr-app-bg min-h-full text-white">

      {/* ── HERO ───────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{
          minHeight: 240,
          borderBottom: '1px solid rgba(255,27,27,0.28)',
        }}
      >
        <DlrHeroArt intensity="high" showTruck />
        <div className="relative z-10 px-4 md:px-8 lg:px-10 py-8 md:py-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Revival Sequences</p>
              <h1 className="dlr-headline mt-2" style={{ fontSize: 'clamp(32px, 4.6vw, 56px)' }}>
                Campaigns
              </h1>
              <p className="mt-4 max-w-2xl text-sm md:text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Your uploaded leads are grouped into ready-to-review campaigns by age.
                Review every message preview before anything is sent — DLR keeps the
                approval gate in your hands.
              </p>
            </div>
            <a
              href="/dealer/import"
              className="dlr-btn-secondary mt-2"
              style={{ height: 38, padding: '0 16px', fontSize: 12 }}
            >
              Upload more leads
              <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </section>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 lg:px-10 py-6 md:py-8 space-y-6">

        {/* Status legend row */}
        <section>
          <p className="dlr-cmd-label mb-3" style={{ color: '#ff5252' }}>
            Status Legend
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {STATUS_LEGEND.map((row) => (
              <article
                key={row.label}
                className="dlr-card px-4 py-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className="flex-shrink-0 inline-flex items-center justify-center rounded-lg"
                    style={{
                      width: 36,
                      height: 36,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: row.color,
                      boxShadow: row.glow,
                    }}
                  >
                    <row.Icon size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white leading-tight">{row.label}</p>
                    <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
                      {row.meaning}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Empty state */}
        {batches.length === 0 && (
          <div
            className="rounded-2xl py-12 px-6 text-center"
            style={{
              background: 'rgba(8,8,10,0.6)',
              border: '1px dashed rgba(255,27,27,0.4)',
            }}
          >
            <p className="text-lg font-black uppercase tracking-wider text-white mb-2">No campaigns yet</p>
            <p className="text-sm max-w-sm mx-auto mb-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Upload leads from the dashboard and DLR will prepare ready-to-review campaigns.
            </p>
            <a href="/dealer/import" className="dlr-btn-primary inline-flex">
              Upload Leads
              <ArrowRight size={16} />
            </a>
          </div>
        )}

        {/* Campaign rows (Concept 4) — always 4 buckets when batches exist */}
        {batches.length > 0 && (
          <section className="space-y-3">
            <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>
              Revival Pipeline
            </p>
            {CAMPAIGN_BUCKETS.map((bucket) => {
              const bucketBatches = batchesByBucket[bucket.key]
              const draftBatch    = bucketBatches.find(b => b.status === 'draft') ?? null
              const liveBatch     = bucketBatches.find(b => b.status === 'sending' || b.status === 'active') ?? null
              const approvedBatch = bucketBatches.find(b => b.status === 'approved') ?? null
              const otherBatch    = bucketBatches.find(b => b.status !== 'draft') ?? null
              const featured      = liveBatch ?? approvedBatch ?? draftBatch ?? otherBatch ?? null

              const featuredLeadCount = featured?.leads.length ?? 0
              const featuredIsEmpty   = featured !== null && featuredLeadCount === 0

              const statusKey: keyof typeof DEALER_BATCH_STATUS | null =
                featured && !featuredIsEmpty
                  ? (featured.status as keyof typeof DEALER_BATCH_STATUS)
                  : null

              const ctaState: 'urgent_draft' | 'view' | 'empty' | 'no_featured' =
                !featured        ? 'no_featured'  :
                featuredIsEmpty  ? 'empty'        :
                draftBatch       ? 'urgent_draft' :
                                   'view'

              const statusLabel =
                !featured       ? 'No leads yet'       :
                featuredIsEmpty ? 'No eligible leads'  :
                DEALER_STATUS_LABEL[featured.status] ?? featured.status

              return (
                <CampaignRow
                  key={bucket.key}
                  bucket={bucket}
                  featuredHref={featured ? `/dealer/batches/${featured.id}` : null}
                  ctaState={ctaState}
                  statusLabel={statusLabel}
                  statusBadgeClass={statusKey ? DEALER_BATCH_STATUS[statusKey].chip : 'dlr-badge-preview'}
                  leadCount={featuredLeadCount}
                />
              )
            })}
          </section>
        )}

        {/* Campaign history — compact list under the bucket rows */}
        {historyBatches.length > 0 && (
          <section className="dlr-card overflow-hidden">
            <header
              className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div>
                <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Campaign History</p>
                <h3 className="text-white text-sm font-black mt-1">
                  {historyBatches.length} campaign{historyBatches.length !== 1 ? 's' : ''}
                </h3>
              </div>
              <p className="text-xs hidden md:block" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Only campaigns marked Live, Sending, or Completed have sent messages.
              </p>
            </header>
            <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              {historyBatches.map(batch => {
                const wf     = batch.workflowId ? workflowMap.get(batch.workflowId) : null
                const bucket = wf?.ageBucket ?? null
                const info   = DEALER_BATCH_STATUS[batch.status] ?? {
                  chip:  'dlr-badge-preview',
                  label: batch.status,
                }
                const hasSends = batch.liveSendCount > 0
                const reportLabel =
                  batch.status === 'completed' ? 'View Results' :
                  batch.status === 'sending' || batch.status === 'paused' ? 'View Status' :
                  null

                return (
                  <li key={batch.id} className="px-5 py-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-white truncate">
                          {wf?.name ?? 'Unknown workflow'}
                        </p>
                        <span className={`dlr-badge ${info.chip}`}>{info.label}</span>
                      </div>
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        {bucket ? `${BUCKET_LABEL[bucket]} · ` : ''}
                        {batch.leads.length} lead{batch.leads.length !== 1 ? 's' : ''}
                        {' · '}
                        {new Date(batch.createdAt).toLocaleDateString()}
                      </p>
                      {hasSends ? (
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                          <strong className="font-bold text-white">{batch.liveSendCount}</strong> sent
                          {' · '}
                          <strong className="font-bold text-white">{batch.replyCount}</strong> repl{batch.replyCount === 1 ? 'y' : 'ies'}
                          {' · '}
                          <strong className="font-bold text-white">{batch.handoffCount}</strong> handoff{batch.handoffCount === 1 ? '' : 's'}
                        </p>
                      ) : (
                        <p className="text-xs italic" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          No messages have been sent from this campaign.
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                      <a
                        href={`/dealer/batches/${batch.id}`}
                        className="dlr-btn-secondary"
                        style={{ height: 32, padding: '0 12px', fontSize: 11 }}
                      >
                        View
                        <ArrowRight size={11} />
                      </a>
                      {reportLabel && (
                        <a
                          href={`/dealer/campaigns/${batch.id}/report`}
                          className="text-[11px] font-bold uppercase tracking-widest"
                          style={{ color: '#ff5252' }}
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
    </div>
  )
}

// ── Campaign row (Concept 4) ─────────────────────────────────────────────────
function CampaignRow({
  bucket,
  featuredHref,
  ctaState,
  statusLabel,
  statusBadgeClass,
  leadCount,
}: {
  bucket: { key: string; label: string; description: string; recommended: boolean }
  featuredHref: string | null
  ctaState: 'urgent_draft' | 'view' | 'empty' | 'no_featured'
  statusLabel: string
  statusBadgeClass: string
  leadCount: number
}) {
  const isReady = ctaState === 'urgent_draft'

  return (
    <article
      className="flex flex-col md:grid items-stretch md:items-center transition-all gap-3 md:gap-5"
      style={{
        // Mobile: column stack. Desktop: 3-col grid (icon+name | spacer | button).
        // Inline desktop grid columns via media-aware className combo above.
        background: 'rgba(12,12,14,0.9)',
        border: isReady
          ? '1px solid rgba(255,27,27,0.65)'
          : '1px solid rgba(255,27,27,0.22)',
        borderLeft: isReady
          ? '3px solid #ff1b1b'
          : '1px solid rgba(255,27,27,0.22)',
        borderRadius: 12,
        minHeight: 86,
        padding: '18px 22px',
        boxShadow: isReady
          ? '0 0 24px rgba(255,27,27,0.32), 0 18px 50px rgba(0,0,0,0.45)'
          : '0 18px 50px rgba(0,0,0,0.4)',
        gridTemplateColumns: 'min-content 1fr auto',
      }}
    >
      {/* Calendar-style age icon */}
      <div className="flex items-start sm:items-center gap-4">
        <span
          className="flex-shrink-0 inline-flex flex-col items-center justify-center rounded-md text-white"
          style={{
            width: 56,
            height: 60,
            background: 'linear-gradient(180deg, #1a0808, #050505)',
            border: '1px solid rgba(255,27,27,0.45)',
            boxShadow: isReady ? '0 0 14px rgba(255,27,27,0.5)' : '0 0 8px rgba(255,27,27,0.25)',
          }}
          aria-hidden="true"
        >
          <Calendar
            size={14}
            style={{ color: '#ff5252', marginTop: 6 }}
          />
          <span
            className="font-black mt-0.5 leading-none"
            style={{ fontSize: 13, color: '#fff' }}
          >
            {bucket.key === 'a' ? '14' : bucket.key === 'b' ? '30' : bucket.key === 'c' ? '60' : '90+'}
          </span>
          <span
            className="font-bold leading-none"
            style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}
          >
            DAYS
          </span>
        </span>

        {/* Name + description + meta */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-black text-white tracking-tight">{bucket.label}</h3>
            {bucket.recommended && ctaState === 'urgent_draft' && (
              <span className="dlr-badge dlr-badge-live">Start Here</span>
            )}
          </div>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {bucket.description}
          </p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {leadCount > 0
                ? `${leadCount} lead${leadCount === 1 ? '' : 's'}`
                : ctaState === 'no_featured' ? 'No leads selected'
                : 'No eligible leads'}
            </span>
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>·</span>
            <span className={`dlr-badge ${statusBadgeClass}`}>
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Status placeholder slot reserved by desktop grid; hidden on mobile so
          the stacked row drops straight to the action button. */}
      <span className="hidden md:block" />

      {/* Action button. Full-width on mobile (stacked row-card), inline on desktop. */}
      <div className="flex-shrink-0 w-full md:w-auto">
        {ctaState === 'urgent_draft' && featuredHref && (
          <a
            href={featuredHref}
            className="dlr-btn-primary w-full md:w-auto"
            style={{ height: 40, padding: '0 18px', fontSize: 12 }}
          >
            Review Campaign
            <ArrowRight size={14} />
          </a>
        )}
        {ctaState === 'view' && featuredHref && (
          <a
            href={featuredHref}
            className="dlr-btn-secondary w-full md:w-auto"
            style={{ height: 40, padding: '0 18px', fontSize: 12 }}
          >
            View Campaign
            <ArrowRight size={14} />
          </a>
        )}
        {ctaState === 'empty' && featuredHref && (
          <a
            href={featuredHref}
            className="inline-flex items-center justify-center gap-2 px-4 rounded-md text-xs font-bold uppercase tracking-widest w-full md:w-auto"
            style={{
              height: 40,
              background: 'rgba(255,255,255,0.04)',
              border: '1px dashed rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.4)',
              cursor: 'not-allowed',
            }}
            aria-disabled="true"
          >
            No eligible leads
          </a>
        )}
        {ctaState === 'no_featured' && (
          <a
            href="/dealer/import"
            className="inline-flex items-center justify-center gap-2 px-4 rounded-md text-xs font-bold uppercase tracking-widest w-full md:w-auto"
            style={{
              height: 40,
              background: 'rgba(255,255,255,0.04)',
              border: '1px dashed rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.45)',
            }}
          >
            Upload leads
            <ArrowRight size={12} />
          </a>
        )}
      </div>
    </article>
  )
}

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
import { Eye, Users, Hourglass, Send, ArrowRight, Calendar } from 'lucide-react'
void pilotBatches

type DealerBatchStatusInfo = { chip: string; label: string }

const DEALER_BATCH_STATUS: Record<string, DealerBatchStatusInfo> = {
  draft:     { chip: 'badge badge-ghost', label: 'Draft / Preview only' },
  previewed: { chip: 'badge badge-ghost', label: 'Preview only' },
  approved:  { chip: 'badge badge-amber', label: 'Approved — not sending yet' },
  sending:   { chip: 'badge badge-green', label: 'Live / Sending' },
  active:    { chip: 'badge badge-green', label: 'Live / Sending' },
  paused:    { chip: 'badge badge-amber', label: 'Paused' },
  completed: { chip: 'badge badge-green', label: 'Completed' },
  cancelled: { chip: 'badge badge-red',   label: 'Cancelled' },
}

// Status legend that matches the spec's four-card row.
const STATUS_LEGEND = [
  {
    label:   'Preview only',
    meaning: 'Draft campaigns, not ready for approval yet.',
    Icon:    Eye,
    color:   'rgba(255,255,255,0.5)',
    glow:    'none',
    chip:    'badge badge-ghost',
  },
  {
    label:   'Ready for review',
    meaning: 'Review messages before approval.',
    Icon:    Users,
    color:   '#ff5252',
    glow:    '0 0 18px rgba(255,27,27,0.35)',
    chip:    'badge badge-red',
  },
  {
    label:   'Approved — not sending yet',
    meaning: 'Approved by you, still paused until final launch.',
    Icon:    Hourglass,
    color:   '#fbbf24',
    glow:    '0 0 18px rgba(245,158,11,0.32)',
    chip:    'badge badge-amber',
  },
  {
    label:   'Live / Sending',
    meaning: 'Messages are going out to your leads.',
    Icon:    Send,
    color:   '#22c55e',
    glow:    '0 0 18px rgba(34,197,94,0.32)',
    chip:    'badge badge-green',
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
    <div style={{ color: 'var(--tx)', fontFamily: 'var(--f-body)' }}>

      {/* ── HERO ───────────────────────────────────────────────────── */}
      <section className="page-hd" style={{ marginBottom: 'var(--gap)' }}>
        <div className="page-hd-stage" aria-hidden="true">
          <div className="page-hd-truck" />
          <div className="page-hd-vig" />
        </div>
        <div className="page-hd-txt" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <span className="eyebrow red">Revival Sequences</span>
            <h1 className="page-title" style={{ marginTop: 6 }}>Campaigns</h1>
            <p style={{ marginTop: 12, maxWidth: 500, fontSize: 14, lineHeight: 1.55, color: 'var(--tx-mid)' }}>
              Your uploaded leads are grouped into ready-to-review campaigns by age.
              Review every message preview before anything is sent — DLR keeps the
              approval gate in your hands.
            </p>
          </div>
          <a href="/dealer/import" className="btn" style={{ height: 38, padding: '0 16px', fontSize: 12, flexShrink: 0, alignSelf: 'flex-end' }}>
            Upload more leads
            <ArrowRight size={14} />
          </a>
        </div>
      </section>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>

        {/* Status legend row */}
        <section>
          <p className="eyebrow red" style={{ marginBottom: 10 }}>Status Legend</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {STATUS_LEGEND.map((row) => (
              <article
                key={row.label}
                className="glass flat"
                style={{ padding: '14px 16px' }}
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
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-hi)', lineHeight: 1.2 }}>{row.label}</p>
                    <p style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5, color: 'var(--tx-lo)' }}>
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
            className="glass"
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              border: '1.5px dashed var(--line-redS)',
            }}
          >
            <p style={{ fontSize: 16, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--tx-hi)', marginBottom: 8 }}>No prepared campaigns yet</p>
            <p style={{ fontSize: 13, maxWidth: 400, margin: '0 auto 20px', color: 'var(--tx-mid)', lineHeight: 1.55 }}>
              Campaign templates are ready. Upload leads and DLR will prepare personalized message sequences for your review — nothing sends until you approve.
            </p>
            <a href="/dealer/import" className="btn btn-primary" style={{ display: 'inline-flex' }}>
              Upload Leads
              <ArrowRight size={16} />
            </a>
          </div>
        )}

        {/* Campaign rows (Concept 4) — always 4 buckets when batches exist */}
        {batches.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="eyebrow red">Revival Pipeline</p>
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
                  statusBadgeClass={statusKey ? DEALER_BATCH_STATUS[statusKey].chip : 'badge badge-ghost'}
                  leadCount={featuredLeadCount}
                />
              )
            })}
          </section>
        )}

        {/* Campaign history — compact list under the bucket rows */}
        {historyBatches.length > 0 && (
          <section className="glass" style={{ overflow: 'hidden' }}>
            <header
              style={{
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <div>
                <p className="eyebrow red">Campaign History</p>
                <h3 style={{ color: 'var(--tx-hi)', fontSize: 13, fontWeight: 800, marginTop: 4 }}>
                  {historyBatches.length} campaign{historyBatches.length !== 1 ? 's' : ''}
                </h3>
              </div>
              <p style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
                Only campaigns marked Live, Sending, or Completed have sent messages.
              </p>
            </header>
            <ul style={{ borderColor: 'var(--line)' }}>
              {historyBatches.map(batch => {
                const wf     = batch.workflowId ? workflowMap.get(batch.workflowId) : null
                const bucket = wf?.ageBucket ?? null
                const info   = DEALER_BATCH_STATUS[batch.status] ?? {
                  chip:  'badge badge-ghost',
                  label: batch.status,
                }
                const hasSends = batch.liveSendCount > 0
                const reportLabel =
                  batch.status === 'completed' ? 'View Results' :
                  batch.status === 'sending' || batch.status === 'paused' ? 'View Status' :
                  null

                return (
                  <li key={batch.id} style={{ padding: '14px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--line)' }}>
                    <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {wf?.name ?? 'Unknown workflow'}
                        </p>
                        <span className={info.chip}>{info.label}</span>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
                        {bucket ? `${BUCKET_LABEL[bucket]} · ` : ''}
                        {batch.leads.length} lead{batch.leads.length !== 1 ? 's' : ''}
                        {' · '}
                        {new Date(batch.createdAt).toLocaleDateString()}
                      </p>
                      {hasSends ? (
                        <p style={{ fontSize: 11, color: 'var(--tx-mid)' }}>
                          <strong style={{ fontWeight: 700, color: 'var(--tx-hi)' }}>{batch.liveSendCount}</strong> sent
                          {' · '}
                          <strong style={{ fontWeight: 700, color: 'var(--tx-hi)' }}>{batch.replyCount}</strong> repl{batch.replyCount === 1 ? 'y' : 'ies'}
                          {' · '}
                          <strong style={{ fontWeight: 700, color: 'var(--tx-hi)' }}>{batch.handoffCount}</strong> handoff{batch.handoffCount === 1 ? '' : 's'}
                        </p>
                      ) : (
                        <p style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--tx-lo)' }}>
                          No messages have been sent from this campaign.
                        </p>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <a
                        href={`/dealer/batches/${batch.id}`}
                        className="btn"
                        style={{ height: 32, padding: '0 12px', fontSize: 11 }}
                      >
                        View
                        <ArrowRight size={11} />
                      </a>
                      {reportLabel && (
                        <a
                          href={`/dealer/campaigns/${batch.id}/report`}
                          className="link-red"
                          style={{ fontSize: 11 }}
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
      className="camp-row"
      style={{
        gridTemplateColumns: 'min-content 1fr auto',
        minHeight: 86,
        borderLeft: isReady ? '3px solid var(--red-core)' : undefined,
        boxShadow: isReady
          ? '0 0 24px rgba(255,27,27,0.32), 0 18px 50px rgba(0,0,0,0.45)'
          : undefined,
      }}
    >
      {/* Calendar-style age icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div className="day-badge" aria-hidden="true">
          <div className="d">{bucket.key === 'a' ? '14' : bucket.key === 'b' ? '30' : bucket.key === 'c' ? '60' : '90+'}</div>
          <div className="u">Days</div>
        </div>

        {/* Name + description + meta */}
        <div className="camp-meta">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {bucket.label}
            {bucket.recommended && ctaState === 'urgent_draft' && (
              <span className="badge badge-red">Start Here</span>
            )}
          </h3>
          <p>{bucket.description}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-mid)' }}>
              {leadCount > 0
                ? `${leadCount} lead${leadCount === 1 ? '' : 's'}`
                : ctaState === 'no_featured' ? 'No leads selected'
                : 'No eligible leads'}
            </span>
            <span style={{ color: 'var(--tx-lo)' }}>·</span>
            <span className={statusBadgeClass}>{statusLabel}</span>
          </div>
        </div>
      </div>

      {/* Spacer column */}
      <span />

      {/* Action button */}
      <div style={{ flexShrink: 0 }}>
        {ctaState === 'urgent_draft' && featuredHref && (
          <a href={featuredHref} className="btn btn-primary" style={{ height: 40, padding: '0 18px', fontSize: 12 }}>
            Review Campaign
            <ArrowRight size={14} />
          </a>
        )}
        {ctaState === 'view' && featuredHref && (
          <a href={featuredHref} className="btn" style={{ height: 40, padding: '0 18px', fontSize: 12 }}>
            View Campaign
            <ArrowRight size={14} />
          </a>
        )}
        {ctaState === 'empty' && featuredHref && (
          <a
            href={featuredHref}
            className="btn"
            style={{ height: 40, padding: '0 18px', fontSize: 12, opacity: 0.4, cursor: 'not-allowed' }}
            aria-disabled="true"
          >
            No eligible leads
          </a>
        )}
        {ctaState === 'no_featured' && (
          <a href="/dealer/import" className="btn" style={{ height: 40, padding: '0 18px', fontSize: 12 }}>
            Upload leads
            <ArrowRight size={12} />
          </a>
        )}
      </div>
    </article>
  )
}

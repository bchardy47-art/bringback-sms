import { redirect } from 'next/navigation'
import { eq, ne, and, count, inArray, notInArray, or, isNull, isNotNull, desc } from 'drizzle-orm'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import { db } from '@/lib/db'
import {
  pilotBatches,
  pilotLeadImports,
  conversations,
  tenants,
  dealerIntakes,
  leads,
  messages,
} from '@/lib/db/schema'
import {
  computeDealerSetupStatus,
  DEALER_STEP_STATUS_LABEL,
  DEALER_STEP_STATUS_CLASS,
  type DealerSetupStep,
  type DealerSetupStatus,
} from '@/lib/dealer/setup-status'
import { DlrHeroArt } from '@/components/dealer/DlrHeroArt'
import {
  Users,
  Send,
  MessageSquare,
  CalendarCheck,
  Zap,
  Eye,
  Hourglass,
  Rocket,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react'

export default async function DealerDashboardPage() {
  const session = await getDealerSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

  const [
    tenantRow,
    importRow,
    draftRow,
    approvedRow,
    completedRow,
    liveSendsRow,
    openConvosForBreakdown,
    intakeRow,
    messagesSentRow,
    recentInboxThreads,
  ] = await Promise.all([
    db.select({
      name:               tenants.name,
      tenDlcStatus:       tenants.tenDlcStatus,
      smsSendingNumber:   tenants.smsSendingNumber,
      smsLiveApproved:    tenants.smsLiveApproved,
      automationPaused:   tenants.automationPaused,
      complianceBlocked:  tenants.complianceBlocked,
    }).from(tenants).where(eq(tenants.id, tenantId)).then(r => r[0] ?? null),

    db.select({ count: count() })
      .from(pilotLeadImports)
      .leftJoin(leads, eq(pilotLeadImports.leadId, leads.id))
      .where(and(
        eq(pilotLeadImports.tenantId, tenantId),
        notInArray(pilotLeadImports.importStatus, ['warning', 'held', 'excluded']),
        or(isNull(pilotLeadImports.leadId), eq(leads.isTest, false)),
        or(
          ne(pilotLeadImports.importStatus, 'selected'),
          isNotNull(pilotLeadImports.leadId),
        ),
      ))
      .then(r => r[0]?.count ?? 0),

    db.select({ count: count() })
      .from(pilotBatches)
      .where(and(eq(pilotBatches.tenantId, tenantId), eq(pilotBatches.status, 'draft')))
      .then(r => r[0]?.count ?? 0),

    db.select({ count: count() })
      .from(pilotBatches)
      .where(and(eq(pilotBatches.tenantId, tenantId), eq(pilotBatches.status, 'approved')))
      .then(r => r[0]?.count ?? 0),

    db.select({ count: count() })
      .from(pilotBatches)
      .where(and(eq(pilotBatches.tenantId, tenantId), eq(pilotBatches.status, 'completed')))
      .then(r => r[0]?.count ?? 0),

    db.select({ count: count() })
      .from(pilotBatches)
      .where(and(
        eq(pilotBatches.tenantId, tenantId),
        inArray(pilotBatches.status, ['sending', 'completed']),
      ))
      .then(r => r[0]?.count ?? 0),

    db.query.conversations.findMany({
      where: and(eq(conversations.tenantId, tenantId), eq(conversations.status, 'open')),
      columns: { id: true, humanTookOverAt: true },
      with: {
        lead: { columns: { isTest: true } },
        messages: {
          orderBy: (m, { desc }) => [desc(m.createdAt)],
          limit: 1,
          columns: { direction: true },
        },
      },
    }).then(rows => rows.filter(c => !c.lead?.isTest)),

    db.query.dealerIntakes.findFirst({
      where: eq(dealerIntakes.tenantId, tenantId),
    }).then(r => r ?? null),

    // Lightweight "messages sent" count for the Today's Pulse panel.
    db.select({ count: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(
        eq(conversations.tenantId, tenantId),
        eq(messages.direction, 'outbound'),
      ))
      .then(r => r[0]?.count ?? 0),

    // Recent inbox preview — limited to 4 rows for the dashboard preview card.
    db.query.conversations.findMany({
      where: and(eq(conversations.tenantId, tenantId), eq(conversations.status, 'open')),
      columns: { id: true, updatedAt: true, humanTookOverAt: true },
      with: {
        lead: { columns: { isTest: true, firstName: true, lastName: true, vehicleOfInterest: true } },
        messages: {
          orderBy: (m, { desc }) => [desc(m.createdAt)],
          limit: 1,
          columns: { body: true, direction: true, createdAt: true },
        },
      },
      orderBy: [desc(conversations.updatedAt)],
      limit: 8,
    }).then(rows => rows.filter(c => !c.lead?.isTest).slice(0, 4)),
  ])

  const dealershipName = tenantRow?.name ?? 'Dealer'
  const importCount    = importRow as number
  const draftCount     = draftRow as number
  const activeCount    = approvedRow as number
  const completedCount = completedRow as number
  const messagesSent   = messagesSentRow as number

  const needsReviewCount = openConvosForBreakdown.filter(c =>
    !c.humanTookOverAt && c.messages[0]?.direction === 'inbound',
  ).length
  const automatedCount = openConvosForBreakdown.filter(c =>
    !c.humanTookOverAt && (c.messages.length === 0 || c.messages[0]?.direction === 'outbound'),
  ).length
  const humanOwnedOpenCount = openConvosForBreakdown.filter(c =>
    !!c.humanTookOverAt,
  ).length
  const inboxCount = openConvosForBreakdown.length

  const inboxHref =
    needsReviewCount     > 0 ? '/dealer/inbox?tab=needs_review' :
    humanOwnedOpenCount  > 0 ? '/dealer/inbox?tab=human_owned'  :
    automatedCount       > 0 ? '/dealer/inbox?tab=automated'    :
                               '/dealer/inbox'

  const firstName = session.user.name?.split(' ')[0] ?? 'there'

  // ── Setup progress ────────────────────────────────────────────────────────
  const setup: DealerSetupStatus = computeDealerSetupStatus({
    intake: intakeRow,
    tenant: tenantRow,
    counts: {
      leadImports:       importCount,
      draftBatches:      draftCount,
      approvedBatches:   activeCount,
      completedBatches:  completedCount,
      openConversations: inboxCount,
    },
  })

  const leadStepStatus = setup.steps.find(s => s.key === 'leads')?.status ?? 'not_started'
  const canUploadNow = leadStepStatus === 'needs_your_action' || leadStepStatus === 'done'

  const intakeToken = intakeRow?.token ?? null
  function actionForStep(stepKey: string, status: string): { label: string; href: string } | null {
    if (status !== 'needs_your_action') return null
    switch (stepKey) {
      case 'payment':
        return { label: 'Finish payment setup', href: '/dealer/settings' }
      case 'form':
        return intakeToken
          ? { label: 'Open setup form',     href: `/intake/${intakeToken}` }
          : { label: 'Complete payment', href: '/dealer/settings' }
      case 'leads':
        return { label: 'Upload leads',  href: '/dealer/import' }
      case 'pilot':
        return { label: 'Review campaign', href: '/dealer/batches' }
      default:
        return null
    }
  }

  const nextStep: { label: string; href: string; stepLabel: string; stepKey: string } | null = (() => {
    const ACTION_ORDER = ['payment', 'form', 'leads', 'pilot'] as const
    for (const key of ACTION_ORDER) {
      const step = setup.steps.find((s) => s.key === key)
      if (!step) continue
      const action = actionForStep(step.key, step.status)
      if (!action) continue
      return { ...action, stepLabel: step.label, stepKey: step.key }
    }
    return null
  })()

  // ── Messaging-state safety ────────────────────────────────────────────────
  const safetyBlocked     = !!(tenantRow?.complianceBlocked || tenantRow?.automationPaused)
  const liveSendsCount    = liveSendsRow as number
  const hasLiveSends      = liveSendsCount > 0
  const hasAnyBatch       = draftCount + activeCount + liveSendsCount > 0
  const smsLiveApproved   = !!tenantRow?.smsLiveApproved
  const safetyBannerState: 'live' | 'in_setup' | 'in_review' | 'not_live' | null =
    safetyBlocked                       ? null         :
    hasLiveSends && smsLiveApproved     ? 'live'       :
    smsLiveApproved                     ? 'in_setup'   :
    hasAnyBatch                         ? 'in_review'  :
                                          'not_live'
  const isLive = safetyBannerState === 'live'

  const doneCount   = setup.steps.filter(s => s.status === 'done').length
  const totalSteps  = setup.steps.length
  const progressPct = totalSteps > 0
    ? Math.round((doneCount / totalSteps) * 100)
    : 0
  const currentStepIndex = setup.steps.findIndex(s => s.status === 'in_progress' || s.status === 'needs_your_action')
  const currentStepNumber = currentStepIndex >= 0 ? currentStepIndex + 1 : Math.min(doneCount + 1, totalSteps || 1)

  const pilotStep        = setup.steps.find(s => s.key === 'pilot')
  const pilotActionable  = pilotStep?.status === 'needs_your_action'
  const reviewLocked     = !pilotActionable && draftCount > 0
  const paymentPending   = setup.steps.find(s => s.key === 'payment')?.status === 'needs_your_action'

  const pulseStats = [
    { label: 'New Leads',         value: importCount },
    { label: 'Messages Sent',     value: messagesSent },
    { label: 'Conversations',     value: inboxCount },
    { label: 'Appointments Set',  value: '—' },
    { label: 'Deals Revived',     value: completedCount },
  ]

  const campaignGroups = [
    { key: '14-30', label: '14–30 Day Follow-Up', desc: 'Recently dead leads — highest revival potential.' },
    { key: '31-60', label: '31–60 Day Follow-Up', desc: 'Mid-window leads cooling off.' },
    { key: '61-90', label: '61–90 Day Revival',   desc: 'Cooling leads needing aggressive outreach.' },
    { key: '91+',   label: '91+ Day Revival',     desc: 'Long-dormant pipeline — revival sequence.' },
  ]

  // ── CTA hierarchy ─────────────────────────────────────────────────────────
  // Hero always leads with a product action. Admin/billing steps are never
  // surfaced as the primary CTA — they appear as a secondary compact alert.
  const productCta: { label: string; href: string } =
    nextStep?.stepKey === 'leads'  ? { label: 'Upload Leads',      href: '/dealer/import' }  :
    nextStep?.stepKey === 'pilot'  ? { label: 'Review Campaign',   href: '/dealer/batches' } :
    draftCount + activeCount > 0   ? { label: 'Review Campaigns',  href: '/dealer/batches' } :
    importCount > 0                ? { label: 'Upload More Leads', href: '/dealer/import' }  :
                                     { label: 'Upload Leads',      href: '/dealer/import' }

  // Only surfaces when account setup needs non-product admin action
  const adminAlert =
    nextStep?.stepKey === 'payment' ? nextStep :
    nextStep?.stepKey === 'form'    ? nextStep :
    null

  return (
    <div style={{ color: 'var(--tx)', fontFamily: 'var(--f-body)' }}>

      {/* ── SECTION 1: HERO ──────────────────────────────────────────── */}
      <section
        className="hero"
        style={{ marginBottom: 'var(--gap)' }}
      >
        {/* Left side — headline + CTAs */}
        <div className="hero-left">
          <span className="eyebrow red">Welcome back, {firstName}</span>
          <h1>
            <span className="w">Revive.</span>
            <span className="w">Reengage.</span>
            <span className="ignite">Reignite.</span>
          </h1>
          <p className="hero-tag">
            {dealershipName}&apos;s dead leads don&apos;t stay dead.<br />
            DLR works the pipeline — you close the deals.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <a href={productCta.href} className="btn btn-primary">
              {productCta.label} <ArrowRight size={16} />
            </a>
            <a href={inboxHref} className="btn">
              Open Inbox <MessageSquare size={16} />
            </a>
          </div>
        </div>

        {/* Truck art stage */}
        <DlrHeroArt intensity="high" showTruck />

        {/* Today&apos;s Pulse panel — absolute overlay on right */}
        <div className="pulse-panel">
          <div className="card-hd" style={{ paddingBottom: 10, marginBottom: 4 }}>
            <span className="card-title">Today&apos;s Pulse</span>
            <span className="dot dot-live" aria-hidden="true" />
          </div>
          {pulseStats.map(s => (
            <div key={s.label} className="pulse-row">
              <span className="k">{s.label}</span>
              <span className="v stat-num" style={{ fontSize: 20 }}>{s.value}</span>
            </div>
          ))}
          <a href={inboxHref} className="link-red" style={{ marginTop: 10, fontSize: 12 }}>
            View Inbox <ArrowRight size={13} />
          </a>
        </div>
      </section>

      {/* ── Body sections ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>

        {/* Safety banner */}
        {safetyBannerState && (
          <MessagingSafetyBanner state={safetyBannerState} dealershipName={dealershipName} />
        )}

        {/* ── Compact admin alert — only for billing/form steps ── */}
        {adminAlert && (
          <div
            role="alert"
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 16px', borderRadius: 12,
              background: 'rgba(255,194,63,0.07)',
              border: '1px solid rgba(255,194,63,0.28)',
            }}
          >
            <span className="dot dot-amber" aria-hidden="true" />
            <span style={{ fontSize: 13, color: 'var(--tx-mid)', flex: 1 }}>
              Action needed:{' '}
              <strong style={{ color: 'var(--tx-hi)', fontWeight: 600 }}>{adminAlert.stepLabel}</strong>
            </span>
            <a
              href={adminAlert.href}
              className="link-red"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {adminAlert.label} <ArrowRight size={12} />
            </a>
          </div>
        )}

        {/* ── SECTION 2: KPI GRID ────────────────────────────────── */}
        <div className="kpi-grid">
          <KpiCard icon={<Users size={20} />}        label="Total Leads"   value={importCount}    href="/dealer/import" />
          <KpiCard icon={<Send size={20} />}          label="Messages Sent" value={messagesSent}   href={inboxHref} />
          <KpiCard icon={<MessageSquare size={20} />} label="Conversations" value={inboxCount}     href={inboxHref} />
          <KpiCard icon={<CalendarCheck size={20} />} label="Appointments"  value="—"              hint="Coming soon" />
          <KpiCard icon={<Zap size={20} />}           label="Deals Revived" value={completedCount} href="/dealer/batches" />
        </div>

        {/* ── SECTION 4: WORK GRID ───────────────────────────────── */}
        <div className="work-grid">

          {/* Campaign Overview */}
          <div className="glass" style={{ padding: 'var(--pad)' }}>
            <div className="card-hd">
              <span className="card-title">Campaign Overview</span>
              <a href="/dealer/batches" className="link-red">
                All Campaigns <ArrowRight size={13} />
              </a>
            </div>
            {!hasAnyBatch && (
              <p style={{ fontSize: 11, color: 'var(--tx-lo)', marginBottom: 8, marginTop: -4, lineHeight: 1.4 }}>
                Campaign templates are ready — upload leads to create personalized campaigns.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {campaignGroups.map((g, i) => {
                const reviewable = pilotActionable && draftCount > 0
                const status: 'preview' | 'ready' | 'live' =
                  isLive && i < liveSendsCount ? 'live' :
                  reviewable                    ? 'ready' :
                                                  'preview'
                return (
                  <CampaignOverviewRow
                    key={g.key}
                    label={g.label}
                    description={g.desc}
                    status={status}
                    reviewLocked={reviewLocked}
                  />
                )
              })}
            </div>
          </div>

          {/* Inbox Preview */}
          <div className="glass" style={{ padding: 'var(--pad)' }}>
            <div className="card-hd">
              <span className="card-title">Inbox Preview</span>
              <a href={inboxHref} className="link-red">
                Open <ArrowRight size={13} />
              </a>
            </div>

            {recentInboxThreads.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--tx-lo)', padding: '12px 0', lineHeight: 1.5 }}>
                No conversations yet. Approved campaigns will land here once live.
              </p>
            ) : (
              recentInboxThreads.map(t => {
                const first = t.lead?.firstName ?? ''
                const last  = t.lead?.lastName  ?? ''
                const name  = `${first} ${last}`.trim() || 'Unknown lead'
                const ini   = (first[0] ?? 'L').toUpperCase() + (last[0] ?? '').toUpperCase()
                const preview = t.messages[0]?.body ?? t.lead?.vehicleOfInterest ?? '—'
                const unread  = t.messages[0]?.direction === 'inbound' && !t.humanTookOverAt
                const time    = t.updatedAt ? relativeTime(t.updatedAt) : ''
                return (
                  <a
                    key={t.id}
                    href={`/dealer/inbox/${t.id}`}
                    className="ip-row"
                    style={{ textDecoration: 'none' }}
                  >
                    <div className="avatar sm" aria-hidden="true">{ini}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nm">
                        <b>{name}</b>
                        <span className="tm">{time}</span>
                      </div>
                      <div className="pv">{preview}</div>
                    </div>
                    {unread && <span className="unread-dot" aria-label="Unread" />}
                  </a>
                )
              })
            )}
          </div>
        </div>

        {/* ── SECTION 4: PERFORMANCE PULSE ──────────────────────── */}
        <div className="glass" style={{ padding: 'var(--pad)' }}>
          <div className="card-hd">
            <span className="card-title">Performance Pulse — Last 14 Days</span>
            <div className="chart-legend">
              <span>
                <i style={{ background: 'var(--red-core)', boxShadow: '0 0 8px var(--red-glow)' }} />
                Messages
              </span>
              <span>
                <i style={{ background: 'rgba(255,255,255,0.5)' }} />
                Conversations
              </span>
            </div>
          </div>
          <PerformancePulse messagesSent={messagesSent} conversations={inboxCount} />
        </div>

        {/* ── SECTION 5: SETUP PROGRESS (secondary — only during onboarding) ── */}
        {setup.showPanel && (
          <SetupProgressCard
            setup={setup}
            progressPct={progressPct}
            totalSteps={totalSteps}
            currentStepNumber={currentStepNumber}
            paymentPending={paymentPending}
            actionForStep={actionForStep}
            nextStepKey={nextStep?.stepKey ?? null}
            dealershipName={dealershipName}
          />
        )}

        {/* Empty-state CTA — only when zero leads AND dealer can actually act */}
        {importCount === 0 && canUploadNow && (
          <div className="dropzone" style={{ textAlign: 'center', padding: '36px 32px' }}>
            <div
              style={{
                width: 48, height: 48, borderRadius: '50%', margin: '0 auto 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                boxShadow: '0 0 18px var(--red-glow)',
                fontSize: 22, color: '#fff', fontWeight: 900,
              }}
              aria-hidden="true"
            >
              ↑
            </div>
            <p className="display" style={{ fontSize: 24, color: 'var(--tx-hi)', marginBottom: 8 }}>
              Start your first revival
            </p>
            <p style={{ fontSize: 14, color: 'var(--tx-mid)', maxWidth: 400, margin: '0 auto 16px', lineHeight: 1.5 }}>
              Upload a CSV of stale leads from your CRM. Each lead is classified by age, paired with
              a message sequence, and surfaced for your review before a single text is sent.
            </p>
            <a href="/dealer/import" className="btn btn-primary">
              Upload your first leads <ArrowRight size={16} />
            </a>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  href,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  href?: string
  hint?: string
}) {
  const inner = (
    <div className="kpi glass">
      <div className="kpi-ico">{icon}</div>
      <div className="kpi-body">
        <div className="kpi-label">{label}</div>
        <div className="kpi-row">
          <span className="stat-num">{value}</span>
          {hint && (
            <span style={{ fontSize: 11, color: 'var(--tx-lo)', whiteSpace: 'nowrap' }}>{hint}</span>
          )}
        </div>
      </div>
    </div>
  )
  return href ? (
    <a href={href} style={{ textDecoration: 'none' }}>{inner}</a>
  ) : (
    inner
  )
}

function CampaignOverviewRow({
  label,
  description,
  status,
  reviewLocked,
}: {
  label: string
  description: string
  status: 'preview' | 'ready' | 'live'
  reviewLocked: boolean
}) {
  const badge =
    status === 'live'  ? <span className="badge badge-green">Live</span>  :
    status === 'ready' ? <span className="badge badge-red">Ready</span>   :
                          <span className="badge badge-ghost">Preview</span>

  const Icon = status === 'live' ? Rocket : status === 'ready' ? Zap : Eye

  return (
    <div className="co-item">
      <div
        className="co-thumb"
        style={{ color: status === 'live' ? 'var(--green)' : status === 'ready' ? 'var(--red-core)' : 'var(--tx-lo)' }}
      >
        <Icon size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="co-title">
          <b>{label}</b>
          {badge}
        </div>
        <p style={{ fontSize: 12, color: 'var(--tx-mid)', marginTop: 3, lineHeight: 1.4 }}>
          {reviewLocked && status !== 'live' ? 'Unlocks after payment' : description}
        </p>
      </div>
    </div>
  )
}

function SetupProgressCard({
  setup,
  progressPct,
  totalSteps,
  currentStepNumber,
  paymentPending,
  actionForStep,
  nextStepKey,
  dealershipName,
}: {
  setup: DealerSetupStatus
  progressPct: number
  totalSteps: number
  currentStepNumber: number
  paymentPending: boolean
  actionForStep: (k: string, s: string) => { label: string; href: string } | null
  nextStepKey: string | null
  dealershipName: string
}) {
  const blocked = setup.overall === 'blocked'
  const radius = 36
  const stroke = 6
  const c = 2 * Math.PI * radius
  const offset = c - (progressPct / 100) * c

  return (
    <section
      className="glass"
      style={{
        padding: 0,
        overflow: 'hidden',
        borderColor: blocked ? 'var(--line-redS)' : undefined,
        boxShadow: blocked
          ? '0 0 0 1px rgba(255,42,42,0.4), 0 0 30px rgba(255,42,42,0.32)'
          : undefined,
      }}
    >
      <div
        style={{
          padding: '20px 20px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
          borderBottom: '1px solid var(--line)',
        }}
      >
        {/* Progress ring */}
        <div style={{ flexShrink: 0 }}>
          <svg width={radius * 2 + stroke * 2} height={radius * 2 + stroke * 2}>
            <circle
              cx={radius + stroke}
              cy={radius + stroke}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={stroke}
            />
            <circle
              cx={radius + stroke}
              cy={radius + stroke}
              r={radius}
              fill="none"
              stroke="var(--red-core)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${radius + stroke} ${radius + stroke})`}
              style={{ filter: 'drop-shadow(0 0 6px var(--red-glow))' }}
            />
            <text
              x={radius + stroke}
              y={radius + stroke + 5}
              textAnchor="middle"
              fill="#fff"
              fontWeight="900"
              fontSize="16"
            >
              {progressPct}%
            </text>
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="eyebrow red">
            {blocked ? 'Account Paused' : 'Setup Progress'}
          </span>
          <p style={{ fontFamily: 'var(--f-display)', fontWeight: 800, fontSize: 20, color: '#fff', marginTop: 3, lineHeight: 1 }}>
            {blocked ? (setup.title || 'Account paused') : `Step ${currentStepNumber} of ${totalSteps}`}
          </p>
          {paymentPending && !blocked && (
            <p style={{ fontSize: 11, marginTop: 4, fontWeight: 700, color: 'var(--amber)' }}>
              Payment required
            </p>
          )}
          <p style={{ fontSize: 12, marginTop: 4, color: 'var(--tx-mid)', lineHeight: 1.4 }}>
            {setup.subtitle || `${dealershipName} setup in progress.`}
          </p>
        </div>
      </div>

      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {setup.steps.map((step, idx) => (
          <SetupStepRow
            key={step.key}
            index={idx + 1}
            step={step}
            action={nextStepKey === step.key ? null : actionForStep(step.key, step.status)}
          />
        ))}
      </ol>
    </section>
  )
}

function SetupStepRow({
  index,
  step,
  action,
}: {
  index:   number
  step:    DealerSetupStep
  action?: { label: string; href: string } | null
}) {
  const isDone   = step.status === 'done'
  const isActive = step.status === 'in_progress' || step.status === 'needs_your_action'

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 20px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <span
        className={`step-num${isDone ? ' done' : isActive ? ' cur' : ''}`}
        style={{ flexShrink: 0, marginTop: 1 }}
        aria-hidden="true"
      >
        {isDone ? '✓' : index}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: isDone ? 'var(--tx-lo)' : 'var(--tx-hi)',
              textDecoration: isDone ? 'line-through' : 'none',
              textDecorationColor: 'rgba(255,255,255,0.25)',
            }}
          >
            {step.label}
          </p>
          <span className={DEALER_STEP_STATUS_CLASS[step.status]}>
            {DEALER_STEP_STATUS_LABEL[step.status]}
          </span>
        </div>

        {step.detail && (
          <p style={{ fontSize: 11, marginTop: 3, color: 'var(--tx-mid)', lineHeight: 1.45 }}>
            {step.detail}
          </p>
        )}

        {action && (
          <a
            href={action.href}
            className="btn btn-primary"
            style={{ marginTop: 8, padding: '8px 14px', fontSize: 12, borderRadius: 9 }}
          >
            {action.label} <ArrowRight size={12} />
          </a>
        )}
      </div>
    </li>
  )
}

// ── Lightweight pulse chart (pure SVG, no new data calls) ────────────────────
function PerformancePulse({ messagesSent, conversations }: { messagesSent: number; conversations: number }) {
  const days = 14
  const maxScale = Math.max(messagesSent, conversations, 10)
  const seedM = (i: number) =>
    Math.max(0, Math.sin(i * 0.7) * 0.4 + Math.cos(i * 0.3) * 0.3 + 0.5) * (messagesSent / days)
  const seedC = (i: number) =>
    Math.max(0, Math.sin(i * 0.5 + 1) * 0.35 + 0.4) * (conversations / days)
  const w = 600
  const h = 140
  const stepX = w / (days - 1)
  const yFor = (v: number) => h - (v / Math.max(1, maxScale / days)) * (h * 0.85) - 8

  const ptsM = Array.from({ length: days }, (_, i) => `${i * stepX},${yFor(seedM(i))}`).join(' ')
  const ptsC = Array.from({ length: days }, (_, i) => `${i * stepX},${yFor(seedC(i))}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 160, marginTop: 12, display: 'block' }}>
      {[0.25, 0.5, 0.75].map(p => (
        <line
          key={p}
          x1={0} x2={w}
          y1={h * p} y2={h * p}
          stroke="rgba(255,255,255,0.05)"
          strokeDasharray="3 5"
        />
      ))}
      <polyline
        fill="none"
        stroke="var(--red-core)"
        strokeWidth="2.5"
        points={ptsM}
        style={{ filter: 'drop-shadow(0 0 6px var(--red-glow))' }}
      />
      <polyline
        fill="none"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="2"
        points={ptsC}
      />
    </svg>
  )
}

// ── Safety banner ─────────────────────────────────────────────────────────────
function MessagingSafetyBanner({
  state,
  dealershipName,
}: {
  state: 'live' | 'in_setup' | 'in_review' | 'not_live'
  dealershipName: string
}) {
  let Icon = CheckCircle2
  let title: string
  let detail: string
  let tone: 'ok' | 'warn' | 'info'

  if (state === 'live') {
    Icon   = CheckCircle2
    title  = `${dealershipName} messaging is live`
    detail = 'Customer replies will appear in Inbox. You stay in control — take over any conversation anytime.'
    tone   = 'ok'
  } else if (state === 'in_setup') {
    Icon   = Hourglass
    title  = 'Setup mode — messages are paused'
    detail = `No customer messages will be sent from ${dealershipName} until payment, campaign review, and final launch approval are complete.`
    tone   = 'warn'
  } else if (state === 'in_review') {
    Icon   = Hourglass
    title  = 'Campaigns in review — not live yet'
    detail = `Approving a campaign prepares it for final review. No messages are sent from ${dealershipName} until DLR activates your account.`
    tone   = 'warn'
  } else {
    Icon   = AlertTriangle
    title  = 'Not sending yet'
    detail = `No customer messages will be sent from ${dealershipName} until your first campaign is reviewed and DLR completes activation with you.`
    tone   = 'info'
  }

  const bg     = tone === 'ok' ? 'rgba(47,217,107,0.10)' : tone === 'warn' ? 'rgba(255,194,63,0.10)' : 'rgba(59,130,246,0.10)'
  const border = tone === 'ok' ? 'rgba(47,217,107,0.40)' : tone === 'warn' ? 'rgba(255,194,63,0.40)' : 'rgba(59,130,246,0.40)'
  const color  = tone === 'ok' ? 'var(--green)' : tone === 'warn' ? 'var(--amber)' : '#93c5fd'

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        borderRadius: 14,
        padding: '12px 16px',
        background: bg,
        border: `1px solid ${border}`,
        backdropFilter: 'blur(10px)',
      }}
    >
      <span
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.4)',
          color,
        }}
      >
        <Icon size={15} />
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color }}>{title}</p>
        <p style={{ fontSize: 12, marginTop: 2, color: 'var(--tx-mid)', lineHeight: 1.45 }}>{detail}</p>
      </div>
    </div>
  )
}

// ── Tiny relative-time helper ─────────────────────────────────────────────────
function relativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

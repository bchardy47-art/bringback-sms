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
    // Pulls from the existing messages table — no new data model.
    db.select({ count: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(
        eq(conversations.tenantId, tenantId),
        eq(messages.direction, 'outbound'),
      ))
      .then(r => r[0]?.count ?? 0),

    // Recent inbox preview — uses the same conversations table the inbox
    // already reads from. Limited to 4 rows for the dashboard preview card.
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
        return { label: 'Complete payment', href: '/dealer/settings' }
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

  // ── Campaign overview rows — reuses dealer batch data only ───────────────
  const campaignGroups = [
    {
      key: '14-30',  label: '14–30 Day Follow-Up',
      desc: 'Recently dead leads — highest revival potential.',
    },
    {
      key: '31-60',  label: '31–60 Day Follow-Up',
      desc: 'Mid-window leads cooling off.',
    },
    {
      key: '61-90',  label: '61–90 Day Revival',
      desc: 'Cooling leads needing aggressive outreach.',
    },
    {
      key: '91+',    label: '91+ Day Revival',
      desc: 'Long-dormant pipeline — revival sequence.',
    },
  ]

  return (
    <div className="dlr-app-bg min-h-full text-white">
      {/* ── HERO ───────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{
          minHeight: 380,
          borderBottom: '1px solid rgba(255,27,27,0.28)',
        }}
      >
        <DlrHeroArt intensity="high" showTruck />

        <div className="relative z-10 px-4 md:px-8 lg:px-10 py-8 md:py-12">
          <div className="grid lg:grid-cols-[1fr_360px] gap-6 lg:gap-10 items-start">
            {/* Left side */}
            <div>
              <p className="dlr-cmd-label" style={{ color: 'rgba(255,82,82,0.85)' }}>
                Dealer Command Center
              </p>
              <h2 className="text-white font-black mt-2"
                style={{
                  fontSize: 'clamp(20px, 2.2vw, 28px)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.78)',
                }}
              >
                Welcome back, {firstName}
              </h2>

              <h1
                className="dlr-headline mt-3"
                style={{
                  fontSize: 'clamp(40px, 5.6vw, 76px)',
                }}
              >
                Revive.<br />Reengage.<br />Reignite.
              </h1>

              <p className="mt-5 max-w-md text-sm md:text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
                We find the dead leads. You close the deals.<br />
                {dealershipName} runs the revival sequence — DLR keeps the engine hot.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                {nextStep ? (
                  <a href={nextStep.href} className="dlr-btn-primary" aria-label={nextStep.label}>
                    {nextStep.label}
                    <ArrowRight size={18} />
                  </a>
                ) : (
                  <a href="/dealer/batches" className="dlr-btn-primary">
                    Launch New Campaign
                    <ArrowRight size={18} />
                  </a>
                )}
                <a href={inboxHref} className="dlr-btn-secondary">
                  Open Inbox
                  <MessageSquare size={16} />
                </a>
              </div>
            </div>

            {/* Right — Today's Pulse card */}
            <div
              className="rounded-2xl p-5 backdrop-blur-md"
              style={{
                background: 'linear-gradient(180deg, rgba(20,20,24,0.92), rgba(8,8,10,0.92))',
                border: '1px solid rgba(255,27,27,0.55)',
                boxShadow:
                  '0 0 0 1px rgba(255,27,27,0.15), 0 0 36px rgba(255,27,27,0.32), 0 18px 50px rgba(0,0,0,0.55)',
              }}
            >
              <div className="flex items-center justify-between">
                <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Today&apos;s Pulse</p>
                <span className="dlr-status-dot" aria-hidden="true" />
              </div>

              <ul className="mt-4 divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                {pulseStats.map((s) => (
                  <li
                    key={s.label}
                    className="flex items-center justify-between py-2.5"
                    style={{ borderTopColor: 'rgba(255,255,255,0.06)' }}
                  >
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>{s.label}</span>
                    <span className="text-base font-black text-white tabular-nums">
                      {s.value}
                    </span>
                  </li>
                ))}
              </ul>

              <a
                href={inboxHref}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest"
                style={{ color: '#ff5252' }}
              >
                View Full Report
                <ArrowRight size={13} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 lg:px-10 py-6 md:py-8 space-y-6">
        {/* Safety banner */}
        {safetyBannerState && (
          <MessagingSafetyBanner state={safetyBannerState} dealershipName={dealershipName} />
        )}

        {/* Setup + Metric row */}
        <div className="grid lg:grid-cols-[360px_1fr] gap-5">
          {/* Setup progress with percent circle */}
          {setup.showPanel ? (
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
          ) : (
            <div className="dlr-card p-5">
              <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Setup Progress</p>
              <p className="mt-2 text-white font-bold">All systems operational</p>
              <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {dealershipName} is fully launched.
              </p>
            </div>
          )}

          {/* Metric cards 5-up */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <MetricCard
              icon={<Users size={20} />}
              label="Total Leads"
              value={importCount}
              href="/dealer/import"
            />
            <MetricCard
              icon={<Send size={20} />}
              label="Messages Sent"
              value={messagesSent}
              href={inboxHref}
            />
            <MetricCard
              icon={<MessageSquare size={20} />}
              label="Conversations"
              value={inboxCount}
              href={inboxHref}
            />
            <MetricCard
              icon={<CalendarCheck size={20} />}
              label="Appointments"
              value="—"
              hint="Coming soon"
            />
            <MetricCard
              icon={<Zap size={20} />}
              label="Deals Revived"
              value={completedCount}
              href="/dealer/batches"
            />
          </div>
        </div>

        {/* Lower grid: Campaign overview + Performance Pulse + Inbox Preview */}
        <div className="grid lg:grid-cols-[1fr_320px] gap-5">
          <div className="space-y-5">
            {/* Campaign Overview */}
            <section className="dlr-card overflow-hidden">
              <header className="px-5 py-4 flex items-center justify-between"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div>
                  <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Campaign Overview</p>
                  <h3 className="text-white text-base font-black mt-0.5">Revival Pipeline</h3>
                </div>
                <a
                  href="/dealer/batches"
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: '#ff5252' }}
                >
                  All Campaigns →
                </a>
              </header>

              <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
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
              </ul>
            </section>

            {/* Performance Pulse — placeholder chart */}
            <section className="dlr-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Performance Pulse</p>
                  <h3 className="text-white text-base font-black mt-0.5">Last 14 Days</h3>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest">
                  <span className="flex items-center gap-1.5" style={{ color: '#ff5252' }}>
                    <span style={{ width: 8, height: 2, background: '#ff1b1b', display: 'inline-block', boxShadow: '0 0 6px rgba(255,27,27,0.7)' }} />
                    Messages Sent
                  </span>
                  <span className="flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    <span style={{ width: 8, height: 2, background: 'rgba(255,255,255,0.6)', display: 'inline-block' }} />
                    Conversations
                  </span>
                </div>
              </div>
              <PerformancePulse messagesSent={messagesSent} conversations={inboxCount} />
            </section>
          </div>

          {/* Inbox Preview */}
          <aside className="dlr-card overflow-hidden">
            <header className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div>
                <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Inbox Preview</p>
                <h3 className="text-white text-base font-black mt-0.5">Latest Activity</h3>
              </div>
              <a
                href={inboxHref}
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: '#ff5252' }}
              >
                Open
              </a>
            </header>

            <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              {recentInboxThreads.length === 0 && (
                <li className="px-5 py-6 text-center">
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    No conversations yet. Approved campaigns will land here once live.
                  </p>
                </li>
              )}
              {recentInboxThreads.map((t) => {
                const first = t.lead?.firstName ?? ''
                const last  = t.lead?.lastName  ?? ''
                const name  = `${first} ${last}`.trim() || 'Unknown lead'
                const initials = (first[0] ?? 'L').toUpperCase() + (last[0] ?? '').toUpperCase()
                const preview = t.messages[0]?.body ?? t.lead?.vehicleOfInterest ?? '—'
                const unread = t.messages[0]?.direction === 'inbound' && !t.humanTookOverAt
                const time = t.updatedAt ? relativeTime(t.updatedAt) : ''
                return (
                  <li key={t.id} className="px-5 py-3 flex items-center gap-3">
                    <span
                      className="flex-shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center text-white text-[11px] font-black"
                      style={{
                        background: 'linear-gradient(135deg, #1a0505, #3a0505)',
                        border: '1px solid rgba(255,27,27,0.45)',
                      }}
                    >
                      {initials}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{name}</p>
                      <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        {preview}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{time}</span>
                      {unread && (
                        <span
                          className="block w-2 h-2 rounded-full"
                          style={{ background: '#ff1b1b', boxShadow: '0 0 8px rgba(255,27,27,0.85)' }}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </aside>
        </div>

        {/* Empty-state CTA — only when zero leads AND dealer can actually act */}
        {importCount === 0 && canUploadNow && (
          <div
            className="rounded-2xl text-center py-10 px-8"
            style={{
              background:
                'linear-gradient(180deg, rgba(20,5,5,0.55), rgba(8,8,10,0.55))',
              border: '1px dashed rgba(255,27,27,0.4)',
              boxShadow: '0 0 30px rgba(255,27,27,0.15)',
            }}
          >
            <div
              className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center text-white font-black text-xl"
              style={{
                background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                boxShadow: '0 0 18px rgba(255,27,27,0.6)',
              }}
            >
              ↑
            </div>
            <p className="text-base font-black uppercase tracking-wide text-white mb-1">Start your first revival</p>
            <p className="text-sm max-w-sm mx-auto leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Upload a CSV of stale leads from your CRM. Each lead is classified by age,
              paired with a message sequence, and surfaced for your review before a single
              text is sent.
            </p>
            <a href="/dealer/import" className="dlr-btn-primary mt-5 inline-flex">
              Upload your first leads
              <ArrowRight size={18} />
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function MetricCard({
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
    <>
      <span
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 44,
          height: 44,
          background: 'rgba(255,27,27,0.14)',
          color: '#ff5252',
          boxShadow: '0 0 22px rgba(255,27,27,0.28)',
          border: '1px solid rgba(255,27,27,0.32)',
        }}
      >
        {icon}
      </span>
      <p className="dlr-cmd-label mt-4">{label}</p>
      <p className="text-3xl font-black text-white mt-1 tabular-nums" style={{ letterSpacing: '-0.02em' }}>
        {value}
      </p>
      <p className="mt-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {hint ?? (typeof value === 'number' ? 'Live revival count' : 'Coming soon')}
      </p>
    </>
  )

  const cls = "block dlr-card p-4 transition-shadow"
  return href ? (
    <a href={href} className={cls} style={{ minHeight: 158 }}>
      {inner}
    </a>
  ) : (
    <div className={cls} style={{ minHeight: 158 }}>
      {inner}
    </div>
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
    status === 'live'    ? <span className="dlr-badge dlr-badge-sending">Live</span> :
    status === 'ready'   ? <span className="dlr-badge dlr-badge-live">Ready</span> :
                            <span className="dlr-badge dlr-badge-preview">Preview</span>

  const Icon = status === 'live' ? Rocket : status === 'ready' ? Zap : Eye
  const iconColor = status === 'live' ? '#22c55e' : status === 'ready' ? '#ff5252' : 'rgba(255,255,255,0.5)'

  return (
    <li className="px-5 py-4 flex items-center gap-4 hover:bg-[rgba(255,27,27,0.04)] transition-colors">
      <span
        className="flex-shrink-0 inline-flex items-center justify-center"
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: iconColor,
          boxShadow: status === 'ready' ? '0 0 14px rgba(255,27,27,0.35)' : 'none',
        }}
      >
        <Icon size={18} />
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">{label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {reviewLocked && status !== 'live' ? 'Unlocks after payment' : description}
        </p>
      </div>

      {badge}
    </li>
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
      className="dlr-card overflow-hidden"
      style={{
        boxShadow: blocked
          ? '0 0 0 1px rgba(255,27,27,0.4), 0 0 30px rgba(255,27,27,0.32), var(--dlr-shadow-card)'
          : undefined,
        borderColor: blocked ? 'rgba(255,27,27,0.55)' : undefined,
      }}
    >
      <div className="px-5 py-5 flex items-start gap-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Circle */}
        <div className="relative flex-shrink-0">
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
              stroke="#ff1b1b"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${radius + stroke} ${radius + stroke})`}
              style={{ filter: 'drop-shadow(0 0 6px rgba(255,27,27,0.7))' }}
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

        <div className="flex-1 min-w-0">
          <p className="dlr-cmd-label" style={{ color: blocked ? '#ff5252' : '#ff5252' }}>
            {blocked ? 'Account Paused' : 'Setup Progress'}
          </p>
          <p className="text-white text-base font-black mt-1">
            {blocked ? (setup.title || 'Account paused') : `Step ${currentStepNumber} of ${totalSteps}`}
          </p>
          {paymentPending && !blocked && (
            <p className="text-[11px] mt-1 font-bold" style={{ color: '#fbbf24' }}>
              Payment required
            </p>
          )}
          <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {setup.subtitle || `${dealershipName} setup in progress.`}
          </p>
        </div>
      </div>

      <ol className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
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
    <li className="flex items-start gap-3 px-5 py-3">
      <span
        className="flex-shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-black mt-0.5"
        style={{
          background: isDone
            ? 'linear-gradient(180deg, #22c55e, #16a34a)'
            : isActive
            ? 'linear-gradient(180deg, #ff2929, #8b0909)'
            : 'rgba(255,255,255,0.06)',
          color:  isDone || isActive ? '#ffffff' : 'rgba(255,255,255,0.5)',
          boxShadow: isActive ? '0 0 12px rgba(255,27,27,0.6)' : 'none',
          border: isActive ? '1px solid rgba(255,80,80,0.6)' : '1px solid rgba(255,255,255,0.08)',
        }}
        aria-hidden="true"
      >
        {isDone ? '✓' : index}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p
            className="text-sm font-bold"
            style={{
              color: isDone ? 'rgba(255,255,255,0.45)' : '#fff',
              textDecoration: isDone ? 'line-through' : 'none',
              textDecorationColor: 'rgba(255,255,255,0.25)',
            }}
          >
            {step.label}
          </p>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${DEALER_STEP_STATUS_CLASS[step.status]}`}
          >
            {DEALER_STEP_STATUS_LABEL[step.status]}
          </span>
        </div>

        {step.detail && (
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {step.detail}
          </p>
        )}

        {action && (
          <a
            href={action.href}
            className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-[11px] font-black rounded-md transition-all"
            style={{
              background: 'linear-gradient(180deg, #ff2929 0%, #a80d0d 100%)',
              border: '1px solid rgba(255,80,80,0.78)',
              color: 'white',
              boxShadow: '0 0 14px rgba(255,27,27,0.5)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {action.label}
            <ArrowRight size={11} />
          </a>
        )}
      </div>
    </li>
  )
}

// ── Lightweight pulse chart (pure SVG) ──────────────────────────────────────
function PerformancePulse({ messagesSent, conversations }: { messagesSent: number; conversations: number }) {
  // Synthesize a 14-day curve from the existing aggregate counts. Pure visual
  // — no new data calls. Heights scale proportionally to the totals.
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
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 w-full" style={{ height: 160 }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((p) => (
        <line
          key={p}
          x1={0}
          x2={w}
          y1={h * p}
          y2={h * p}
          stroke="rgba(255,255,255,0.05)"
          strokeDasharray="3 5"
        />
      ))}
      {/* Messages sent — red */}
      <polyline
        fill="none"
        stroke="#ff1b1b"
        strokeWidth="2.5"
        points={ptsM}
        style={{ filter: 'drop-shadow(0 0 6px rgba(255,27,27,0.5))' }}
      />
      {/* Conversations — soft white */}
      <polyline
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="2"
        points={ptsC}
        strokeDasharray="0"
      />
    </svg>
  )
}

// ── Safety banner ──────────────────────────────────────────────────────────
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
    Icon = CheckCircle2
    title  = `${dealershipName} messaging is live`
    detail = 'Customer replies will appear in Inbox. You stay in control — take over any conversation anytime.'
    tone   = 'ok'
  } else if (state === 'in_setup') {
    Icon = Hourglass
    title  = 'Setup mode — messages are paused'
    detail = `No customer messages will be sent from ${dealershipName} until payment, campaign review, and final launch approval are complete.`
    tone   = 'warn'
  } else if (state === 'in_review') {
    Icon = Hourglass
    title  = 'Campaigns in review — not live yet'
    detail = `Approving a campaign prepares it for final review. No messages are sent from ${dealershipName} until DLR activates your account.`
    tone   = 'warn'
  } else {
    Icon = AlertTriangle
    title  = 'Not sending yet'
    detail = `No customer messages will be sent from ${dealershipName} until your first campaign is reviewed and DLR completes activation with you.`
    tone   = 'info'
  }

  const bg = tone === 'ok'
    ? 'rgba(34,197,94,0.12)'
    : tone === 'warn'
    ? 'rgba(245,158,11,0.10)'
    : 'rgba(59,130,246,0.10)'
  const border = tone === 'ok'
    ? 'rgba(34,197,94,0.42)'
    : tone === 'warn'
    ? 'rgba(245,158,11,0.45)'
    : 'rgba(59,130,246,0.45)'
  const color = tone === 'ok' ? '#4ade80' : tone === 'warn' ? '#fbbf24' : '#93c5fd'

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-xl px-4 py-3"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        backdropFilter: 'blur(10px)',
      }}
    >
      <span
        className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full"
        style={{ background: 'rgba(0,0,0,0.4)', color }}
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold" style={{ color }}>{title}</p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>{detail}</p>
      </div>
    </div>
  )
}

// ── Tiny relative-time helper ───────────────────────────────────────────────
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

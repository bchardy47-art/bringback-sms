import { redirect } from 'next/navigation'
import { eq, ne, and, count, inArray, notInArray, or, isNull, isNotNull, desc } from 'drizzle-orm'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import { trackEvent } from '@/lib/activity/track'
import { db } from '@/lib/db'
import {
  pilotBatches,
  pilotLeadImports,
  conversations,
  tenants,
  dealerIntakes,
  leads,
  messages,
  workflows,
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

  await trackEvent('dealer_dashboard_viewed', { actor: session.user, path: '/dealer/dashboard' })

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
    recentBatchesRaw,
    importQueueRow,
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

    // Recent pilot batches for the Campaign Overview section. We cap at 16
    // because the dashboard only ever renders one card per ageBucket (a/b/c/d),
    // and the dedupe-by-bucket step prefers the newest batch in each bucket.
    // Test leads are filtered out so a tenant whose only "lead" is a test
    // record is treated the same as a zero-batch tenant.
    db.query.pilotBatches.findMany({
      where: (pb, { eq: eq_ }) => eq_(pb.tenantId, tenantId),
      with: { leads: { with: { lead: { columns: { isTest: true } } } } },
      orderBy: (pb, { desc: desc_ }) => [desc_(pb.createdAt)],
      limit: 16,
    }),

    // Import-review queue total — mirrors the denominator on /dealer/import
    // (the "(N of M leads)" header). We use this to surface a small "+X in
    // review" hint under the Total Leads KPI so the dashboard count and the
    // upload page count don't read as contradictory. Filter logic matches
    // /dealer/import: exclude only `excluded` + `held` + test leads.
    db.select({ count: count() })
      .from(pilotLeadImports)
      .leftJoin(leads, eq(pilotLeadImports.leadId, leads.id))
      .where(and(
        eq(pilotLeadImports.tenantId, tenantId),
        notInArray(pilotLeadImports.importStatus, ['excluded', 'held']),
        or(isNull(pilotLeadImports.leadId), eq(leads.isTest, false)),
      ))
      .then(r => r[0]?.count ?? 0),
  ])

  const dealershipName = tenantRow?.name ?? 'Dealer'
  const importCount    = importRow as number
  const draftCount     = draftRow as number
  const activeCount    = approvedRow as number
  const completedCount = completedRow as number
  const messagesSent   = messagesSentRow as number
  const importQueueCount = importQueueRow as number

  // Rows the dealer can still see on /dealer/import that are NOT yet counted
  // as promoted customer records (warning / needs_review / blocked / selected
  // without a leadId). Surfaced as a small "+N in review" chip on the Total
  // Leads KPI so a dealer who sees the upload page's "of M leads" header
  // doesn't think DLR has silently dropped records. Clamped to >= 0 because
  // the two queries use slightly different filters and can in edge cases
  // produce a negative diff for hand-curated datasets.
  const inReviewOrBlockedCount = Math.max(0, importQueueCount - importCount)

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

  const rawFirstName = session.user.name?.split(' ')[0]?.trim() ?? ''
  const firstName = (!rawFirstName || rawFirstName.toLowerCase() === 'admin')
    ? dealershipName
    : rawFirstName

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

  // Today's Pulse panel. `Customer Leads` reads as the count of records
  // promoted into the leads table after import validation (i.e. the same
  // number shown in the Total Leads KPI). The optional `In review` row only
  // renders when there's a non-zero queue waiting, to keep the panel quiet
  // on fresh tenants.
  const pulseStats: Array<{ label: string; value: number | string }> = [
    { label: 'Customer Leads',    value: importCount },
    ...(inReviewOrBlockedCount > 0
      ? [{ label: 'In Review',    value: inReviewOrBlockedCount }]
      : []),
    { label: 'Messages Sent',     value: messagesSent },
    { label: 'Conversations',     value: inboxCount },
    { label: 'Deals Revived',     value: completedCount },
  ]

  // ── Campaign Overview — real draft batches vs template fallback ──────────
  //
  // Previously this card always rendered a static 4-row template list, even
  // when the dealer had real PREVIEW ONLY drafts on `/dealer/batches`. That
  // contradicted the Campaigns page and made the dashboard's first impression
  // misleading. We now query the dealer's actual batches up top (limit 16)
  // and surface up to one per ageBucket here. Each card links to the matching
  // batch detail page. When the dealer has zero batches we keep the existing
  // template list as a fallback — no behaviour change for new tenants.

  /** Per-bucket display copy. Kept aligned with `/dealer/batches`'s
   *  CAMPAIGN_BUCKETS array so the dashboard and Campaigns page tell the same
   *  story when both are open side-by-side. */
  const CAMPAIGN_BUCKET_DISPLAY: Record<'a' | 'b' | 'c' | 'd', { label: string; description: string }> = {
    a: { label: '14–30 Day Follow-Up', description: 'Recently quiet leads — a short re-engagement window.'   },
    b: { label: '31–60 Day Follow-Up', description: 'Cooling leads — a gentle nudge back to the dealership.' },
    c: { label: '61–90 Day Revival',   description: 'Aging leads — strong revival candidates.'               },
    d: { label: '91+ Day Revival',     description: 'Long-cold leads — last-chance outreach.'                },
  }

  const campaignGroups = [
    { key: '14-30', label: CAMPAIGN_BUCKET_DISPLAY.a.label, desc: 'Recently dead leads — highest revival potential.' },
    { key: '31-60', label: CAMPAIGN_BUCKET_DISPLAY.b.label, desc: 'Mid-window leads cooling off.' },
    { key: '61-90', label: CAMPAIGN_BUCKET_DISPLAY.c.label, desc: 'Cooling leads needing aggressive outreach.' },
    { key: '91+',   label: CAMPAIGN_BUCKET_DISPLAY.d.label, desc: 'Long-dormant pipeline — revival sequence.' },
  ]

  // Strip test leads from every batch, mirroring `/dealer/batches`.
  const recentBatches = recentBatchesRaw.map(b => ({
    ...b,
    leads: b.leads.filter(bl => !bl.lead?.isTest),
  }))

  // Pull workflow rows for the batches so we know each one's ageBucket. Only
  // one extra query, and only when batches exist.
  const recentWorkflowIds = Array.from(
    new Set(recentBatches.map(b => b.workflowId).filter((id): id is string => !!id)),
  )
  const recentWorkflowRows = recentWorkflowIds.length > 0
    ? await db
        .select({ id: workflows.id, name: workflows.name, ageBucket: workflows.ageBucket })
        .from(workflows)
        .where(inArray(workflows.id, recentWorkflowIds))
    : []
  const recentWorkflowMap = new Map(recentWorkflowRows.map(w => [w.id, w]))

  type DashboardCampaignCard = {
    id:          string
    bucket:      'a' | 'b' | 'c' | 'd'
    label:       string
    description: string
    leadCount:   number
    status:      'preview' | 'ready' | 'live'
    href:        string
  }

  /** Map a pilot-batch status into the dashboard's preview/ready/live tri-state. */
  function dashboardStatusFor(status: string): 'preview' | 'ready' | 'live' {
    if (status === 'sending' || status === 'active' || status === 'completed') return 'live'
    if (status === 'approved') return 'ready'
    return 'preview' // draft | previewed | anything else
  }

  // Dedupe by ageBucket, keeping the newest batch per bucket (the Promise.all
  // query is ordered desc, so the first batch we see for each bucket wins).
  const dashboardCampaignCards: DashboardCampaignCard[] = []
  const seenBucketsForCards = new Set<'a' | 'b' | 'c' | 'd'>()
  for (const batch of recentBatches) {
    const wf     = batch.workflowId ? recentWorkflowMap.get(batch.workflowId) : null
    const bucket = wf?.ageBucket
    if (bucket !== 'a' && bucket !== 'b' && bucket !== 'c' && bucket !== 'd') continue
    if (seenBucketsForCards.has(bucket)) continue
    seenBucketsForCards.add(bucket)
    const display = CAMPAIGN_BUCKET_DISPLAY[bucket]
    dashboardCampaignCards.push({
      id:          batch.id,
      bucket,
      label:       display.label,
      description: display.description,
      leadCount:   batch.leads.length,
      status:      dashboardStatusFor(batch.status),
      href:        `/dealer/batches/${batch.id}`,
    })
  }
  dashboardCampaignCards.sort((a, b) => a.bucket.localeCompare(b.bucket))

  const hasRealCampaignCards = dashboardCampaignCards.length > 0

  // ── CTA hierarchy ─────────────────────────────────────────────────────────
  // Hero always leads with a product action. Admin/billing steps are never
  // surfaced as the primary CTA — they appear as a secondary compact alert.
  const productCta: { label: string; href: string } =
    nextStep?.stepKey === 'leads'  ? { label: 'Upload Leads',      href: '/dealer/import' }  :
    nextStep?.stepKey === 'pilot'  ? { label: 'Review Campaign',   href: '/dealer/batches' } :
    draftCount + activeCount > 0   ? { label: 'Review Campaigns',  href: '/dealer/batches' } :
    importCount > 0                ? { label: 'Upload Leads',      href: '/dealer/import' }  :
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
        <div
          className="pulse-panel"
          style={{
            borderColor: 'rgba(255,27,27,0.16)',
            boxShadow: '0 0 18px rgba(255,27,27,0.14)',
            background: 'rgba(10,10,12,0.88)',
          }}
        >
          <div className="card-hd" style={{ paddingBottom: 8, marginBottom: 2 }}>
            <span className="card-title">Today&apos;s Pulse</span>
            <span className="dot dot-live" aria-hidden="true" />
          </div>
          {pulseStats.map(s => (
            <div key={s.label} className="pulse-row">
              <span className="k">{s.label}</span>
              <span className="v stat-num" style={{ fontSize: 18 }}>{s.value}</span>
            </div>
          ))}
          <a href={inboxHref} className="link-red" style={{ marginTop: 8, fontSize: 11.5 }}>
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
              background: adminAlert.stepKey === 'payment'
                ? 'rgba(34,197,94,0.06)'
                : 'rgba(255,194,63,0.07)',
              border: adminAlert.stepKey === 'payment'
                ? '1px solid rgba(34,197,94,0.18)'
                : '1px solid rgba(255,194,63,0.28)',
            }}
          >
            <span
              className={adminAlert.stepKey === 'payment' ? 'dot dot-live' : 'dot dot-amber'}
              aria-hidden="true"
            />
            {adminAlert.stepKey === 'payment' ? (
              <span style={{ fontSize: 13, color: 'var(--tx-mid)', flex: 1 }}>
                Free pilot active —{' '}
                <strong style={{ color: 'var(--tx-hi)', fontWeight: 600 }}>
                  billing is not required during pilot setup.
                </strong>
              </span>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}

        {/* ── SECTION 2: KPI GRID ──────────────────────────────────
            Customer Leads is the count of records promoted into the leads
            table after import validation. The `hint` chip surfaces any
            queue still on /dealer/import so the dashboard total and the
            upload-page header don't read as contradictory. The card's
            `subtitle` makes the relationship explicit. */}
        <div className="kpi-grid">
          <KpiCard
            icon={<Users size={20} />}
            label="Customer Leads"
            value={importCount}
            href="/dealer/import"
            hint={inReviewOrBlockedCount > 0 ? `+${inReviewOrBlockedCount} in review` : undefined}
            subtitle={inReviewOrBlockedCount > 0
              ? 'Validated leads grouped and ready for revival campaigns. Upload Leads also shows rows still in review.'
              : 'Validated leads grouped and ready for revival campaigns.'}
          />
          <KpiCard icon={<Send size={20} />}          label="Messages Sent" value={messagesSent}   href={inboxHref} />
          <KpiCard icon={<MessageSquare size={20} />} label="Conversations" value={inboxCount}     href={inboxHref} />
          <KpiCard icon={<Zap size={20} />}           label="Deals Revived" value={completedCount} href="/dealer/batches" />
        </div>

        {/* ── SECTION 4: WORK GRID ───────────────────────────────── */}
        <div className="work-grid">

          {/* Campaign Overview — real draft batches when present, templates otherwise */}
          <div className="glass" style={{ padding: 'var(--pad)' }}>
            <div className="card-hd">
              <span className="card-title">Campaign Overview</span>
              <a href="/dealer/batches" className="link-red">
                All Campaigns <ArrowRight size={13} />
              </a>
            </div>
            {hasRealCampaignCards ? (
              <p style={{ fontSize: 11, color: 'var(--tx-lo)', marginBottom: 8, marginTop: -4, lineHeight: 1.4 }}>
                Your draft campaigns are ready for review.
              </p>
            ) : (
              <p style={{ fontSize: 11, color: 'var(--tx-lo)', marginBottom: 8, marginTop: -4, lineHeight: 1.4 }}>
                Campaign templates are ready — upload leads to start.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hasRealCampaignCards
                ? dashboardCampaignCards.map(card => (
                    <CampaignOverviewRow
                      key={card.id}
                      label={card.label}
                      description={card.description}
                      status={card.status}
                      reviewLocked={false}
                      href={card.href}
                      leadCount={card.leadCount}
                    />
                  ))
                : campaignGroups.map((g, i) => {
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

        {/* ── SECTION 6: PERFORMANCE PULSE ──────────────────────── */}
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
  subtitle,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  href?: string
  /** Small inline chip rendered next to the stat value (e.g. "Coming soon",
   *  "+49 in review"). */
  hint?: string
  /** Optional small explanatory line under the value row. Used when the
   *  number's meaning needs disambiguation (e.g. Customer Leads vs the
   *  Upload Leads queue count). */
  subtitle?: string
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
        {subtitle && (
          <p style={{ fontSize: 11, color: 'var(--tx-lo)', marginTop: 4, lineHeight: 1.4 }}>
            {subtitle}
          </p>
        )}
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
  href,
  leadCount,
}: {
  label:       string
  description: string
  status:      'preview' | 'ready' | 'live'
  reviewLocked: boolean
  /** When set, the entire row becomes an anchor pointing at this href (used
   *  for real draft batches that link into the batch detail page). */
  href?:       string
  /** Optional lead count rendered as a small meta line under the description.
   *  Only used for the real-draft variant; template fallback never sets it. */
  leadCount?:  number
}) {
  const badge =
    status === 'live'  ? <span className="badge badge-green">Live</span>  :
    status === 'ready' ? <span className="badge badge-red">Ready</span>   :
                          <span className="badge badge-ghost">Preview only</span>

  const Icon = status === 'live' ? Rocket : status === 'ready' ? Zap : Eye

  const body = (
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
          {reviewLocked && status !== 'live' ? 'Available once pilot setup is complete' : description}
        </p>
        {typeof leadCount === 'number' && (
          <p style={{ fontSize: 11, color: 'var(--tx-lo)', marginTop: 4, fontWeight: 600 }}>
            {leadCount} lead{leadCount === 1 ? '' : 's'}
          </p>
        )}
      </div>
    </div>
  )

  return href ? (
    <a href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      {body}
    </a>
  ) : (
    body
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
  const doneCount = setup.steps.filter(s => s.status === 'done').length
  const nextStep = setup.steps.find(s => s.status === 'needs_your_action')
    ?? setup.steps.find(s => s.status === 'in_progress')
    ?? setup.steps.find(s => s.status === 'waiting_on_dlr')
    ?? null
  const radius = 28
  const stroke = 5
  const c = 2 * Math.PI * radius
  const offset = c - (progressPct / 100) * c
  const summaryTitle = blocked
    ? setup.title
    : setup.title || `${doneCount} of ${totalSteps} steps complete`
  const summaryMeta = blocked
    ? 'DLR is holding your setup safely until launch-ready.'
    : `Step ${Math.min(currentStepNumber, totalSteps || 1)} of ${Math.max(totalSteps, 1)} • ${doneCount} complete`
  const summaryDescription = setup.subtitle || `${dealershipName} setup in progress.`
  const nextLabel = blocked
    ? 'Status'
    : nextStep?.status === 'waiting_on_dlr'
      ? 'Waiting on DLR'
      : nextStep?.status === 'in_progress'
        ? 'In progress'
        : nextStep?.status === 'needs_your_action'
          ? 'Next step'
          : 'Current status'
  const nextText = blocked
    ? summaryDescription
    : setup.nextHint || nextStep?.detail || summaryDescription

  return (
    <section
      id="setup-progress"
      className="glass"
      style={{
        padding: 0,
        overflow: 'hidden',
        borderColor: blocked ? 'var(--line-redS)' : undefined,
        boxShadow: blocked
          ? '0 0 0 1px rgba(255,42,42,0.32), 0 0 24px rgba(255,42,42,0.22)'
          : undefined,
      }}
    >
      <div
        style={{
          padding: '16px 18px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          borderBottom: '1px solid var(--line)',
        }}
      >
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
              style={{ filter: 'drop-shadow(0 0 5px var(--red-glow))' }}
            />
            <text
              x={radius + stroke}
              y={radius + stroke + 4}
              textAnchor="middle"
              fill="#fff"
              fontWeight="900"
              fontSize="13"
            >
              {progressPct}%
            </text>
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <span className="eyebrow red">
                {blocked ? 'Setup status' : 'Setup progress'}
              </span>
              <p style={{ fontFamily: 'var(--f-display)', fontWeight: 800, fontSize: 18, color: '#fff', marginTop: 4, lineHeight: 1.05 }}>
                {summaryTitle}
              </p>
              <p style={{ fontSize: 11, marginTop: 4, color: 'var(--tx-lo)', lineHeight: 1.35 }}>
                {summaryMeta}
              </p>
            </div>
            <span className={DEALER_STEP_STATUS_CLASS[nextStep?.status ?? (paymentPending ? 'waiting_on_dlr' : 'in_progress')]}>
              {blocked ? 'Waiting on DLR' : nextStep ? DEALER_STEP_STATUS_LABEL[nextStep.status] : 'In progress'}
            </span>
          </div>

          <p style={{ fontSize: 12, marginTop: 8, color: 'var(--tx-mid)', lineHeight: 1.45 }}>
            {summaryDescription}
          </p>

          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--tx-lo)', marginBottom: 4, fontWeight: 700 }}>
              {nextLabel}
            </p>
            <p style={{ fontSize: 12, color: 'var(--tx-mid)', lineHeight: 1.4 }}>
              {nextText}
            </p>
          </div>
        </div>
      </div>

      <ol style={{ listStyle: 'none', padding: '6px 0', margin: 0 }}>
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
  const isDone = step.status === 'done'
  const isActive = step.status === 'in_progress' || step.status === 'needs_your_action'
  const isWaiting = step.status === 'waiting_on_dlr'

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '9px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        opacity: isDone ? 0.72 : 1,
      }}
    >
      <span
        className={`step-num${isDone ? ' done' : isActive ? ' cur' : ''}`}
        style={{ flexShrink: 0, marginTop: 1, transform: 'scale(0.92)' }}
        aria-hidden="true"
      >
        {isDone ? '✓' : index}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: isDone ? 500 : 600,
              color: isDone ? 'var(--tx-lo)' : 'var(--tx-hi)',
              textDecoration: 'none',
            }}
          >
            {step.label}
          </p>
          <span className={DEALER_STEP_STATUS_CLASS[step.status]}>
            {DEALER_STEP_STATUS_LABEL[step.status]}
          </span>
        </div>

        {step.detail && (!isDone || isWaiting || action) && (
          <p style={{ fontSize: 10.5, marginTop: 2, color: 'var(--tx-mid)', lineHeight: 1.4 }}>
            {step.detail}
          </p>
        )}

        {action && (
          <a
            href={action.href}
            className="btn btn-primary"
            style={{ marginTop: 7, padding: '7px 12px', fontSize: 11.5, borderRadius: 9 }}
          >
            {action.label} <ArrowRight size={11} />
          </a>
        )}
      </div>
    </li>
  )
}

// ── Lightweight pulse chart (pure SVG, no new data calls) ────────────────────
function PerformancePulse({ messagesSent, conversations }: { messagesSent: number; conversations: number }) {
  if (messagesSent === 0 && conversations === 0) {
    return (
      <div style={{
        marginTop: 12,
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        border: '1px dashed rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{ textAlign: 'center', lineHeight: 1.5 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-mid)' }}>
            No sends yet
          </p>
          <p style={{ fontSize: 12, color: 'var(--tx-lo)', marginTop: 4 }}>
            Performance data will appear after your first campaign launches.
          </p>
        </div>
      </div>
    )
  }

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

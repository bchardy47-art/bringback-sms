import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, and, count, inArray } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  pilotBatches,
  pilotLeadImports,
  conversations,
  tenants,
  dealerIntakes,
} from '@/lib/db/schema'
import {
  computeDealerSetupStatus,
  DEALER_STEP_STATUS_LABEL,
  DEALER_STEP_STATUS_CLASS,
  type DealerSetupStep,
  type DealerSetupStatus,
} from '@/lib/dealer/setup-status'
import {
  pauseTenantAutomation,
  resumeTenantAutomation,
} from '@/lib/admin/dlr-queries'
import { ConfirmingForm } from '@/app/(dashboard)/admin/dlr/ConfirmingForm'

// Dealer-friendly pause/resume confirmation strings — reused by the
// automation status card below. Kept here so updates land in one place.
const PAUSE_CONFIRM_PROMPT =
  'This will pause DLR automation for your dealership. No automated ' +
  'follow-up will run until resumed. Continue?'
const RESUME_CONFIRM_PROMPT =
  'This will resume DLR automation for your dealership. Only approved/' +
  'live workflows will continue. Continue?'

export default async function DealerDashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  // Dealer-scoped pause/resume server actions. Re-verify the session
  // inside each action body — the closure's `session` reference can be
  // stale by the time a form submit fires, and we never want to operate
  // on anyone but the signed-in dealer's own tenant. Underlying
  // mutation reuses the admin dlr-queries helpers but tenant scope is
  // strictly the dealer's own.
  async function dealerPauseAutomation() {
    'use server'
    const s = await getServerSession(authOptions)
    if (!s || s.user.role !== 'dealer') throw new Error('Unauthorized')
    await pauseTenantAutomation(s.user.tenantId)
    revalidatePath('/dealer/dashboard')
  }
  async function dealerResumeAutomation() {
    'use server'
    const s = await getServerSession(authOptions)
    if (!s || s.user.role !== 'dealer') throw new Error('Unauthorized')
    await resumeTenantAutomation(s.user.tenantId)
    revalidatePath('/dealer/dashboard')
  }

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
      .where(eq(pilotLeadImports.tenantId, tenantId))
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

    // Strong evidence that customer messages have actually been or are
    // being sent for this tenant. 'sending' = mid-flight; 'completed' =
    // first batch finished. ONLY this count gates the green "DLR
    // messaging is live" banner — the internal sms_live_approved flag
    // alone is insufficient because admins can flip it before a dealer
    // has reached payment / setup form / pilot review (see Janet @ Test
    // Motors Honda QA).
    db.select({ count: count() })
      .from(pilotBatches)
      .where(and(
        eq(pilotBatches.tenantId, tenantId),
        inArray(pilotBatches.status, ['sending', 'completed']),
      ))
      .then(r => r[0]?.count ?? 0),

    // Open conversations with their last message direction + human-takeover
    // flag. The inbox tabs slice the same set three ways (needs_review /
    // automated / human_owned), so we compute the breakdown here to label
    // the dashboard card honestly and to deep-link the dealer into the tab
    // that actually has conversations to act on. Previously this was a
    // simple count query, which made the card read "Open" while the dealer
    // landed on an empty "Needs Review" tab and assumed the count was wrong.
    db.query.conversations.findMany({
      where: and(eq(conversations.tenantId, tenantId), eq(conversations.status, 'open')),
      columns: { id: true, humanTookOverAt: true },
      with: {
        messages: {
          orderBy: (m, { desc }) => [desc(m.createdAt)],
          limit: 1,
          columns: { direction: true },
        },
      },
    }),

    db.query.dealerIntakes.findFirst({
      where: eq(dealerIntakes.tenantId, tenantId),
    }).then(r => r ?? null),
  ])

  const dealershipName = tenantRow?.name ?? 'Dealer'
  const importCount    = importRow as number
  const draftCount     = draftRow as number
  const activeCount    = approvedRow as number
  const completedCount = completedRow as number

  // Categorize open conversations using the SAME predicates as the inbox
  // sidebar's tab filters — keeps dashboard counts and the deep-link
  // landing tab consistent.
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

  // Pick the most-actionable tab for the dashboard CTA. Priority:
  //   needs_review (dealer must reply) >
  //   human_owned  (dealer is already in the loop) >
  //   automated    (passive watch) >
  //   default
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

  // Step 6 ("Lead upload ready") status drives whether the empty-state CTA
  // points the dealer to upload (their action) or to wait (passive).
  const leadStepStatus = setup.steps.find(s => s.key === 'leads')?.status ?? 'not_started'
  const canUploadNow = leadStepStatus === 'needs_your_action' || leadStepStatus === 'done'

  // Per-step "what should I click" mapping for steps in `needs_your_action`.
  // Returns null for steps where there's nothing the dealer can click —
  // e.g. carrier registration pending, sending number assignment, launch
  // approval — those stay labeled "Waiting on DLR" / "Not started" only.
  // Token, when needed, is taken from the intake row already loaded above;
  // it's embedded in href only, never rendered as visible text.
  const intakeToken = intakeRow?.token ?? null
  function actionForStep(stepKey: string, status: string): { label: string; href: string } | null {
    if (status !== 'needs_your_action') return null
    switch (stepKey) {
      case 'payment':
        // Billing settings page exposes the "Finish payment setup →" recovery
        // button that deep-links into the intake/payment flow.
        return { label: 'Complete payment', href: '/dealer/settings' }
      case 'form':
        // Stage 2 onboarding form lives at /intake/<token>. If no token (rare,
        // admin-provisioned tenant), drop to settings as a soft fallback.
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

  // ── Next step — the single most important thing for the dealer to do
  // right now. Same source of truth as the setup-progress panel below;
  // we just lift it above the fold so a returning dealer never has to
  // hunt for it. Picks the earliest `needs_your_action` step that maps
  // to a clickable action (payment > form > leads > pilot).
  const nextStep: { label: string; href: string; stepLabel: string } | null = (() => {
    const ACTION_ORDER = ['payment', 'form', 'leads', 'pilot'] as const
    for (const key of ACTION_ORDER) {
      const step = setup.steps.find((s) => s.key === key)
      if (!step) continue
      const action = actionForStep(step.key, step.status)
      if (!action) continue
      return { ...action, stepLabel: step.label }
    }
    return null
  })()

  // ── Messaging-state safety banner ─────────────────────────────────────────
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

  // ── Setup progress percentage ─────────────────────────────────────────────
  const doneCount   = setup.steps.filter(s => s.status === 'done').length
  const progressPct = setup.steps.length > 0
    ? Math.round((doneCount / setup.steps.length) * 100)
    : 0

  const stats = [
    {
      label:   'Leads Imported',
      value:   importCount,
      href:    '/dealer/import',
      numColor: '#111827',
      accent:  '#e5e7eb',
      desc:    'Total leads in your pipeline',
    },
    {
      label:   'Campaigns Awaiting Review',
      value:   draftCount,
      href:    '/dealer/batches',
      numColor: draftCount > 0 ? '#1d4ed8' : '#9ca3af',
      accent:  draftCount > 0 ? '#3b82f6' : '#e5e7eb',
      desc:    'Draft campaigns ready for your approval',
    },
    {
      label:   'Approved Campaigns',
      value:   activeCount,
      href:    '/dealer/batches',
      numColor: '#065f46',
      accent:  '#10b981',
      desc:    'Campaigns you have approved',
    },
    {
      label:   isLive ? 'Active Conversations' : 'Prepared Message Previews',
      value:   inboxCount,
      href:    inboxHref,
      numColor: isLive
        ? (inboxCount > 0 ? '#9a3412' : '#9ca3af')
        : (inboxCount > 0 ? '#1e40af' : '#9ca3af'),
      accent:  isLive
        ? (inboxCount > 0 ? '#f97316' : '#e5e7eb')
        : (inboxCount > 0 ? '#60a5fa' : '#e5e7eb'),
      desc:    isLive
        ? 'Customer replies and live conversations.'
        : 'Draft message previews only — nothing sent to customers yet.',
    },
  ]

  const allStatsZero   = importCount + draftCount + activeCount + inboxCount === 0
  const showReassurance = allStatsZero && setup.showPanel

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-5 md:space-y-6">

      {/* ── Page header ─────────────────────────────────────────────────
          Dealership-branded framing: dealership owns the workspace, DLR
          is the engine. Powered-by line keeps DLR visible without
          implying the dealership built the software. */}
      <div className="pb-1">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">
          {dealershipName} Revival Center
        </h1>
        <p className="mt-0.5 text-xs font-medium uppercase tracking-widest text-gray-400">
          Powered by DLR
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Review prepared campaigns, message previews, and revived lead conversations.
        </p>
        <p className="mt-1 text-xs text-gray-400">Hey {firstName} — here&apos;s where things stand.</p>
      </div>

      {/* ── Messaging-state safety banner ─────────────────────────────── */}
      {safetyBannerState && (
        <MessagingSafetyBanner state={safetyBannerState} dealershipName={dealershipName} />
      )}

      {/* ── Next Step card ────────────────────────────────────────────────
          Lifted above the setup-progress panel so the dealer never has
          to hunt for the single action that unblocks their account.
          Hidden when the account is paused/blocked (setup panel handles
          that case) or when there's no actionable next step (e.g. all
          dealer-side work is done and we're waiting on DLR ops). */}
      {nextStep && !tenantRow?.complianceBlocked && !tenantRow?.automationPaused && (
        <NextStepCard
          stepLabel={nextStep.stepLabel}
          actionLabel={nextStep.label}
          href={nextStep.href}
        />
      )}

      {/* ── System Status card (compact) ─────────────────────────────────
          Suppressed when compliance-blocked (setup panel already alerts). */}
      {!tenantRow?.complianceBlocked && (
        <DealerAutomationStatusCard
          isLive={isLive}
          paused={!!tenantRow?.automationPaused}
          pauseAction={dealerPauseAutomation}
          resumeAction={dealerResumeAutomation}
        />
      )}

      {/* ── DLR Setup Progress ────────────────────────────────────────── */}
      {setup.showPanel && (
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

          {/* Card header with progress */}
          <div
            className="px-5 py-4"
            style={{
              background: setup.overall === 'blocked' ? '#fef2f2' : '#f9fafb',
              borderBottom: `1px solid ${setup.overall === 'blocked' ? '#fecaca' : '#f3f4f6'}`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: setup.overall === 'blocked' ? '#dc2626' : '#6b7280' }}
                >
                  {setup.overall === 'blocked' ? 'Account Paused' : 'Setup Progress'}
                </p>
                <h2 className="text-base font-bold text-gray-900 mt-0.5">
                  {/* Render-site rename: setup-status.ts pure function
                      keeps its own copy ('DLR Setup Progress', 'Account
                      paused', etc.); the dealer surface re-titles it as
                      the dealership's workspace. Blocked-state alerts
                      keep the loud 'Account paused' label — branding
                      doesn't override a compliance alert. */}
                  {setup.overall === 'blocked'
                    ? (setup.title || 'Account paused')
                    : `${dealershipName} Setup Progress`}
                </h2>
                {setup.subtitle && (
                  <p className="text-xs text-gray-500 mt-1 max-w-lg">{setup.subtitle}</p>
                )}
                {setup.nextHint && (
                  <p className="text-xs text-gray-700 mt-1.5 font-medium">
                    Next: <span className="font-normal">{setup.nextHint}</span>
                  </p>
                )}
              </div>
              {/* Progress percentage */}
              <div className="flex-shrink-0 text-right">
                <p
                  className="text-2xl font-bold"
                  style={{ color: setup.overall === 'blocked' ? '#dc2626' : progressPct === 100 ? '#059669' : '#111827' }}
                >
                  {progressPct}%
                </p>
                <p className="text-xs text-gray-400 mt-0.5">complete</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#e5e7eb' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPct}%`,
                  background: setup.overall === 'blocked'
                    ? '#ef4444'
                    : progressPct === 100
                    ? '#10b981'
                    : 'linear-gradient(90deg, #dc2626, #ef4444)',
                }}
              />
            </div>
          </div>

          {/* Step list */}
          <ol className="divide-y divide-gray-100">
            {setup.steps.map((step, idx) => (
              <SetupStepRow
                key={step.key}
                index={idx + 1}
                step={step}
                action={actionForStep(step.key, step.status)}
              />
            ))}
          </ol>
        </section>
      )}

      {/* ── Stats grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:gap-4">
        {stats.map(({ label, value, href, numColor, accent, desc }) => (
          <a
            key={label}
            href={href}
            className="bg-white border border-gray-200 rounded-xl px-4 md:px-5 py-4 md:py-5 shadow-sm hover:shadow-md transition-shadow block overflow-hidden relative"
          >
            {/* Colored top accent bar */}
            <div
              className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl"
              style={{ backgroundColor: accent }}
            />
            <p className="text-3xl font-bold mt-1" style={{ color: numColor }}>{value}</p>
            <p className="text-sm font-semibold text-gray-700 mt-1">{label}</p>
            <p className="text-xs text-gray-400 mt-0.5 leading-snug">{desc}</p>
          </a>
        ))}
      </div>

      {/* Reassurance when everything is zero AND setup isn't done */}
      {showReassurance && (
        <div className="rounded-xl border border-dashed border-gray-200 px-5 py-3.5 text-center">
          <p className="text-sm text-gray-500">
            Nothing is broken — your account is working through setup. Stats will appear here as each step completes.
          </p>
        </div>
      )}

      {/* ── Quick actions ─────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid #f3f4f6' }}>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Quick Actions</p>
        </div>
        <div className="divide-y divide-gray-100">
          <a
            href="/dealer/import"
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors group"
          >
            <div>
              <p className="text-sm font-semibold text-gray-800">Upload Leads</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Upload a CSV from your CRM — DLR classifies and prepares each lead automatically.
              </p>
            </div>
            <span className="text-gray-300 group-hover:text-gray-500 transition-colors text-lg leading-none ml-4">→</span>
          </a>

          <a
            href="/dealer/batches"
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">Review Campaigns</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Preview message sequences and approve campaigns before anything sends.
                </p>
              </div>
              {draftCount > 0 && (
                <span className="flex-shrink-0 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                  {draftCount} pending
                </span>
              )}
            </div>
            <span className="text-gray-300 group-hover:text-gray-500 transition-colors text-lg leading-none ml-4">→</span>
          </a>

          <a
            href={inboxHref}
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">Open Inbox</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  See customer replies and take over hot conversations for your sales team.
                </p>
              </div>
              {inboxCount > 0 && (
                <span className="flex-shrink-0 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-bold rounded-full">
                  {inboxCount} active
                </span>
              )}
            </div>
            <span className="text-gray-300 group-hover:text-gray-500 transition-colors text-lg leading-none ml-4">→</span>
          </a>
        </div>
      </div>

      {/* Empty-state CTA — only when zero leads AND dealer can actually act */}
      {importCount === 0 && canUploadNow && (
        <div
          className="rounded-xl border-2 border-dashed py-10 px-8 text-center"
          style={{ borderColor: '#e5e7eb' }}
        >
          <div
            className="w-10 h-10 rounded-full mx-auto mb-3 flex items-center justify-center text-white font-bold text-lg"
            style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}
          >
            ↑
          </div>
          <p className="text-base font-bold text-gray-800 mb-1">Start your first revival</p>
          <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
            Upload a CSV of stale leads from your CRM. DLR classifies them by age, builds
            message sequences, and lets you review everything before a single text is sent.
          </p>
          <a
            href="/dealer/import"
            className="mt-5 inline-block px-6 py-2.5 text-white text-sm font-bold rounded-xl transition-colors"
            style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}
          >
            Upload your first leads →
          </a>
        </div>
      )}
    </div>
  )
}

// ── Setup step row ──────────────────────────────────────────────────────────

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
    <li className="flex items-start gap-3.5 px-5 py-3.5">
      {/* Step indicator */}
      <span
        className="flex-shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold mt-0.5"
        style={{
          backgroundColor: isDone ? '#10b981' : isActive ? '#dc2626' : '#f3f4f6',
          color:           isDone ? '#ffffff' : isActive ? '#ffffff' : '#9ca3af',
        }}
        aria-hidden="true"
      >
        {isDone ? '✓' : index}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p
            className="text-sm font-semibold"
            style={{
              color:          isDone ? '#9ca3af' : '#111827',
              textDecoration: isDone ? 'line-through' : 'none',
              textDecorationColor: '#d1d5db',
            }}
          >
            {step.label}
          </p>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${DEALER_STEP_STATUS_CLASS[step.status]}`}
          >
            {DEALER_STEP_STATUS_LABEL[step.status]}
          </span>
        </div>

        {step.detail && (
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.detail}</p>
        )}

        {action && (
          <a
            href={action.href}
            className="inline-flex items-center mt-2 px-3.5 py-1.5 text-xs font-bold text-white rounded-lg transition-colors"
            style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}
          >
            {action.label} →
          </a>
        )}
      </div>
    </li>
  )
}

// ── Next step card ──────────────────────────────────────────────────────────
//
// Single, unmissable "do this next" CTA. Driven by computeDealerSetupStatus
// (via actionForStep above) so it never drifts from the setup panel below.

function NextStepCard({
  stepLabel,
  actionLabel,
  href,
}: {
  stepLabel:   string
  actionLabel: string
  href:        string
}) {
  return (
    <a
      href={href}
      className="block rounded-xl border border-red-200 bg-gradient-to-r from-red-50 to-white px-5 py-4 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-4">
        <span
          className="flex-shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center text-white text-base font-bold"
          style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}
          aria-hidden="true"
        >
          →
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-red-700">
            Your next step
          </p>
          <p className="text-base font-bold text-gray-900 mt-0.5 truncate">
            {actionLabel}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            Completes the &ldquo;{stepLabel}&rdquo; step in your setup.
          </p>
        </div>
        <span className="hidden sm:inline-flex flex-shrink-0 items-center px-3.5 py-2 text-xs font-bold text-white rounded-lg"
          style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}>
          {actionLabel} →
        </span>
      </div>
    </a>
  )
}

// ── Messaging safety banner ─────────────────────────────────────────────────
//
// Compact, professional status strip. Four states; suppressed when the
// account is blocked or paused (setup panel already alerts in red for those).
// Calm, dealer-friendly copy — red is reserved for actual problems.

function MessagingSafetyBanner({
  state,
  dealershipName,
}: {
  state: 'live' | 'in_setup' | 'in_review' | 'not_live'
  /** Templated into the detail copy so the safety statement says exactly
      which dealership is (or isn't) sending. */
  dealershipName: string
}) {
  let icon:  string
  let title: string
  let detail: string
  let bg:     string
  let border: string
  let iconBg: string
  let titleColor: string

  if (state === 'live') {
    icon   = '✓'
    title  = `${dealershipName} messaging is live`
    detail = 'Customer replies will appear in Inbox. You stay in control — take over any conversation anytime.'
    bg     = '#f0fdf4'
    border = '#bbf7d0'
    iconBg = '#22c55e'
    titleColor = '#14532d'
  } else if (state === 'in_setup') {
    icon   = '⏳'
    title  = 'Setup mode — messages are paused'
    detail = `No customer messages will send from ${dealershipName} until payment, campaign review, and final launch approval are complete.`
    bg     = '#fffbeb'
    border = '#fde68a'
    iconBg = '#f59e0b'
    titleColor = '#78350f'
  } else if (state === 'in_review') {
    icon   = '⏳'
    title  = 'Campaigns in review — not live yet'
    detail = `Approving a campaign prepares it for final review. No messages send from ${dealershipName} until DLR activates your account.`
    bg     = '#fffbeb'
    border = '#fde68a'
    iconBg = '#f59e0b'
    titleColor = '#78350f'
  } else {
    icon   = 'ℹ'
    title  = 'Not sending yet'
    detail = `No customer messages will send from ${dealershipName} until your first campaign is reviewed and DLR completes activation with you.`
    bg     = '#eff6ff'
    border = '#bfdbfe'
    iconBg = '#3b82f6'
    titleColor = '#1e3a8a'
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-lg px-4 py-3"
      style={{ backgroundColor: bg, border: `1px solid ${border}` }}
    >
      <span
        className="flex-shrink-0 w-5 h-5 rounded-full inline-flex items-center justify-center text-white text-xs font-bold mt-0.5"
        style={{ backgroundColor: iconBg }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold" style={{ color: titleColor }}>{title}</p>
        <p className="text-xs mt-0.5 text-gray-600 leading-relaxed">{detail}</p>
      </div>
    </div>
  )
}

// ── Dealer automation status card ──────────────────────────────────────────
//
// Compact "System Status" pill card — intentionally smaller and less alarming
// than the old bordered section. Three states: not_live (gray, no action),
// running (green, pause button), paused (amber, resume button).

function DealerAutomationStatusCard({
  isLive,
  paused,
  pauseAction,
  resumeAction,
}: {
  isLive:       boolean
  paused:       boolean
  pauseAction:  () => Promise<void>
  resumeAction: () => Promise<void>
}) {
  let dotColor:   string
  let statusText: string
  let detail:     string
  let button:     'pause' | 'resume' | null

  if (paused) {
    dotColor   = '#f59e0b'
    statusText = 'Paused'
    detail     = 'No automated follow-up is running. Existing conversations remain in Inbox.'
    button     = 'resume'
  } else if (isLive) {
    dotColor   = '#22c55e'
    statusText = 'Running'
    detail     = 'DLR is managing approved live conversations for your dealership.'
    button     = 'pause'
  } else {
    dotColor   = '#d1d5db'
    statusText = 'Not live yet'
    detail     = 'Automation will start once campaign review and live-send activation are complete.'
    button     = null
  }

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3.5 flex items-center gap-4"
    >
      {/* Status dot */}
      <span
        className="flex-shrink-0 w-2 h-2 rounded-full"
        style={{ backgroundColor: dotColor }}
      />

      {/* Label + detail */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">System Status</p>
          <span className="text-xs text-gray-300">·</span>
          <p
            className="text-xs font-semibold"
            style={{ color: paused ? '#d97706' : isLive ? '#16a34a' : '#6b7280' }}
          >
            {statusText}
          </p>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{detail}</p>
      </div>

      {/* Pause / Resume button */}
      {button === 'pause' && (
        <ConfirmingForm action={pauseAction} confirmMessage={PAUSE_CONFIRM_PROMPT}>
          <button
            type="submit"
            className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
          >
            Pause
          </button>
        </ConfirmingForm>
      )}
      {button === 'resume' && (
        <ConfirmingForm action={resumeAction} confirmMessage={RESUME_CONFIRM_PROMPT}>
          <button
            type="submit"
            className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
          >
            Resume
          </button>
        </ConfirmingForm>
      )}
    </div>
  )
}

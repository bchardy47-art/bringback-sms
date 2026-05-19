import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq, and, count } from 'drizzle-orm'
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

export default async function DealerDashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

  const [
    tenantRow,
    importRow,
    draftRow,
    approvedRow,
    completedRow,
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

  const dealershipName = tenantRow?.name ?? 'Your Dealership'
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
        return { label: 'Finish payment setup →', href: '/dealer/settings' }
      case 'form':
        // Stage 2 onboarding form lives at /intake/<token>. If no token (rare,
        // admin-provisioned tenant), drop to settings as a soft fallback.
        return intakeToken
          ? { label: 'Open setup form →',     href: `/intake/${intakeToken}` }
          : { label: 'Finish payment setup →', href: '/dealer/settings' }
      case 'leads':
        return { label: 'Upload leads →',  href: '/dealer/import' }
      case 'pilot':
        return { label: 'Review batches →', href: '/dealer/batches' }
      default:
        return null
    }
  }

  const stats = [
    {
      label: 'Leads Imported',
      value: importCount,
      href:  '/dealer/import',
      color: 'text-gray-900',
      bg:    'bg-white',
      desc:  'Total leads in your pipeline',
    },
    {
      label: 'Batches Awaiting Review',
      value: draftCount,
      href:  '/dealer/batches',
      color: draftCount > 0 ? 'text-blue-700' : 'text-gray-300',
      bg:    draftCount > 0 ? 'bg-blue-50'    : 'bg-white',
      desc:  'Draft batches ready for your approval',
    },
    {
      label: 'Approved Batches',
      value: activeCount,
      href:  '/dealer/batches',
      color: 'text-emerald-700',
      bg:    'bg-white',
      desc:  'Batches you have approved',
    },
    {
      label: 'Active Conversations',
      value: inboxCount,
      href:  inboxHref,
      color: inboxCount > 0 ? 'text-orange-600' : 'text-gray-300',
      bg:    inboxCount > 0 ? 'bg-orange-50'   : 'bg-white',
      desc:  'Includes automated and human-owned conversations.',
    },
  ]

  const allStatsZero = importCount + draftCount + activeCount + inboxCount === 0
  const showReassurance = allStatsZero && setup.showPanel

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 md:space-y-8">

      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Hey {firstName} 👋
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {dealershipName} — here&apos;s where your Dead Lead Revival pipeline stands.
        </p>
      </div>

      {/* ── DLR Setup Progress panel ───────────────────────────────────── */}
      {setup.showPanel && (
        <section
          className={`rounded-xl border-2 p-4 md:p-6 ${
            setup.overall === 'blocked' ? 'border-red-300 bg-red-50' : 'border-blue-200 bg-blue-50'
          }`}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase tracking-widest ${
                setup.overall === 'blocked' ? 'text-red-700' : 'text-blue-700'
              }`}>
                {setup.overall === 'blocked' ? 'Account paused' : 'DLR Setup Progress'}
              </p>
              <h2 className="text-lg md:text-xl font-bold text-gray-900 mt-0.5">
                {setup.title || 'DLR Setup Progress'}
              </h2>
              <p className="text-sm text-gray-700 mt-1 max-w-2xl">
                {setup.subtitle}
              </p>
              {setup.nextHint && (
                <p className="text-sm font-medium text-gray-900 mt-3">
                  Next: <span className="font-normal">{setup.nextHint}</span>
                </p>
              )}
            </div>
          </div>

          <ol className="mt-4 space-y-2">
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

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4">
        {stats.map(({ label, value, href, color, bg, desc }) => (
          <a
            key={label}
            href={href}
            className={`${bg} border border-gray-200 rounded-xl px-4 md:px-6 py-4 md:py-5 shadow-sm hover:shadow transition-shadow block`}
          >
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className="text-sm font-semibold text-gray-700 mt-1">{label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
          </a>
        ))}
      </div>

      {/* Reassurance when everything is zero AND setup isn't done */}
      {showReassurance && (
        <div className="rounded-xl border border-dashed border-gray-200 px-5 py-3 text-center">
          <p className="text-sm text-gray-600">
            Nothing is broken — your account is waiting for the next setup step.
          </p>
        </div>
      )}

      {/* Quick actions */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-900">Quick Actions</p>
        </div>
        <div className="divide-y divide-gray-100">
          <a
            href="/dealer/import"
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div>
              <p className="text-sm font-semibold text-gray-800">Upload Dead Leads</p>
              <p className="text-xs text-gray-500">Upload a CSV of prior dealership leads — DLR will prepare them for admin review.</p>
            </div>
            <span className="text-gray-400 text-sm">→</span>
          </a>
          <a
            href="/dealer/batches"
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">Review Batches</p>
                <p className="text-xs text-gray-500">Preview message sequences and approve pilot batches</p>
              </div>
              {draftCount > 0 && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                  {draftCount} pending
                </span>
              )}
            </div>
            <span className="text-gray-400 text-sm">→</span>
          </a>
          <a
            href={inboxHref}
            className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">Open Inbox</p>
                <p className="text-xs text-gray-500">See replies and hand off hot leads to your team</p>
              </div>
              {inboxCount > 0 && (
                <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-bold rounded-full">
                  {inboxCount} active
                </span>
              )}
            </div>
            <span className="text-gray-400 text-sm">→</span>
          </a>
        </div>
      </div>

      {/* Empty-state CTA — only when zero leads AND dealer can actually act */}
      {importCount === 0 && canUploadNow && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 px-8 text-center">
          <p className="text-base font-semibold text-gray-700 mb-2">Start your first revival</p>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Upload a CSV of dead leads from your CRM. DLR will classify them, build message sequences,
            and let you review everything before a single text is sent.
          </p>
          <a
            href="/dealer/import"
            className="mt-5 inline-block px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 transition-colors"
          >
            Upload your first leads →
          </a>
        </div>
      )}
    </div>
  )
}

// ── Step row component ──────────────────────────────────────────────────────

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
    <li className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2.5">
      <span
        className={`flex-shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold ${
          isDone   ? 'bg-emerald-500 text-white' :
          isActive ? 'bg-blue-600    text-white' :
                     'bg-gray-200    text-gray-500'
        }`}
        aria-hidden="true"
      >
        {isDone ? '✓' : index}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className={`text-sm font-semibold ${isDone ? 'text-gray-500' : 'text-gray-900'}`}>
            {step.label}
          </p>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${
              DEALER_STEP_STATUS_CLASS[step.status]
            }`}
          >
            {DEALER_STEP_STATUS_LABEL[step.status]}
          </span>
        </div>
        {step.detail && (
          <p className="text-xs text-gray-600 mt-0.5">{step.detail}</p>
        )}
        {action && (
          <div className="mt-2 flex justify-start sm:justify-end">
            <a
              href={action.href}
              className="inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 transition-colors"
            >
              {action.label}
            </a>
          </div>
        )}
      </div>
    </li>
  )
}

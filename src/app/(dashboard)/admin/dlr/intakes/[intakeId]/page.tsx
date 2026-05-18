import { notFound } from 'next/navigation'
import { and, eq, count } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@/lib/db'
import { dealerIntakes, tenants, phoneNumbers, dealerInvites } from '@/lib/db/schema'
import {
  computeChecklist,
  getLaunchStatusLabel,
  getLaunchStatusColor,
} from '@/lib/intake/checklist'
import {
  computeOperatorStatus,
  OPERATOR_STEP_ORDER,
  OPERATOR_STEP_LABEL,
  type OperatorStep,
  type StepStatus,
} from '@/lib/intake/operator-status'
import {
  auditIntake,
  buildPacketSections,
  buildFullPacket,
  buildCampaignNarrative,
  buildSampleMessagesBlock,
} from '@/lib/intake/tendlc-copilot'
import { getChecklistExtras } from './actions'
import {
  ChecklistPanel,
  AdminNotesPanel,
  CopyButton,
  CopySummaryButton,
  ExternalLinkButton,
  TenDlcCopilotPanel,
} from './IntakeDetailClient'

// Format a single value-or-em-dash line for a copy block.
function packetLine(label: string, value: string | number | null | undefined): string {
  const v = value == null || value === '' ? '—' : String(value)
  return `${label}: ${v}`
}

function buildContactBlock(intake: typeof dealerIntakes.$inferSelect): string {
  return [
    packetLine('Name',  intake.primaryContactName),
    packetLine('Email', intake.primaryContactEmail),
    packetLine('Phone', intake.alertPhone ?? intake.storePhone),
  ].join('\n')
}

// Best-effort URL normalizer for the dealer-website link button. The intake
// form already accepts bare-domain entries; mirror that tolerance here so
// the link always opens cleanly.
function ensureHttp(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `https://${url}`
}

// ── Progress strip (Operator Command Center) ─────────────────────────────────
//
// 8-step compact strip across the top of the command center: shows which
// stages are done (green), which is current (blue), and which are still
// pending (gray). Wraps on narrow viewports.

function ProgressStrip({
  stepStatus,
  currentStep,
}: {
  stepStatus:  Record<OperatorStep, StepStatus>
  currentStep: OperatorStep
}) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 items-center text-xs">
      {OPERATOR_STEP_ORDER.map((step, idx) => {
        const status   = stepStatus[step]
        const isLast   = idx === OPERATOR_STEP_ORDER.length - 1
        const isHere   = step === currentStep
        const label    = OPERATOR_STEP_LABEL[step]
        const dotClass =
          status === 'done'    ? 'bg-emerald-500 text-white' :
          isHere               ? 'bg-blue-600 text-white'    :
                                 'bg-gray-200 text-gray-500'
        const labelClass =
          status === 'done'    ? 'text-emerald-700' :
          isHere               ? 'text-blue-800 font-semibold' :
                                 'text-gray-400'

        return (
          <li key={step} className="flex items-center gap-1.5">
            <span className={`inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-bold ${dotClass}`}>
              {status === 'done' ? '✓' : idx + 1}
            </span>
            <span className={`${labelClass} whitespace-nowrap`}>{label}</span>
            {!isLast && <span className="text-gray-300 mx-1">›</span>}
          </li>
        )
      })}
    </ol>
  )
}

function SidebarRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800 mt-0.5 break-words">
        {value ?? <span className="text-gray-300 italic">—</span>}
      </p>
    </div>
  )
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 space-y-3" style={{ borderBottom: '1px solid #f3f4f6' }}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  )
}

export default async function IntakeDetailPage({
  params,
}: {
  params: { intakeId: string }
}) {
  const intake = await db.query.dealerIntakes.findFirst({
    where: eq(dealerIntakes.id, params.intakeId),
  })
  if (!intake) notFound()

  const tenant = intake.tenantId
    ? await db.query.tenants.findFirst({ where: eq(tenants.id, intake.tenantId) }) ?? null
    : null

  const extras = await getChecklistExtras(intake.tenantId)
  const checklist = computeChecklist(intake, tenant, extras)

  // Active-number + dealer-invite counts power the Operator Command
  // Center status. Both are simple existence checks; we read the count
  // because the small table makes it cheap and the UI doesn't need the
  // rows themselves.
  const [phoneCountRow, inviteCountRow] = intake.tenantId
    ? await Promise.all([
        db.select({ c: count() })
          .from(phoneNumbers)
          .where(and(
            eq(phoneNumbers.tenantId, intake.tenantId),
            eq(phoneNumbers.isActive, true),
          )),
        db.select({ c: count() })
          .from(dealerInvites)
          .where(eq(dealerInvites.tenantId, intake.tenantId)),
      ])
    : [[{ c: 0 }], [{ c: 0 }]]
  const phoneCount  = phoneCountRow[0]?.c ?? 0
  const inviteCount = inviteCountRow[0]?.c ?? 0

  const operatorStatus = computeOperatorStatus({
    intake, tenant, extras, phoneCount, inviteCount,
  })

  const tenDlcStep = checklist.find(c => c.key === '10dlc_submitted')
  const tenDlcPending = tenDlcStep?.status === 'pending'

  // 10DLC Submission Copilot — pure audit + packet derived at request time.
  // Surfaced when 10DLC hasn't been submitted yet; replaces the older
  // TenDlcSubmitActions block. Read-only; the only mutation is the existing
  // mark10dlcPending server action triggered from inside the panel.
  const tendlcAudit    = auditIntake(intake, tenant)
  const tendlcSections = buildPacketSections(intake, tenant)
  const tendlcFull     = buildFullPacket(tendlcSections)
  const tendlcNarrative = buildCampaignNarrative(tendlcSections)
  const tendlcSamples   = buildSampleMessagesBlock(tendlcSections)

  const contactBlock     = buildContactBlock(intake)

  const submittedAt = intake.submittedAt
    ? new Date(intake.submittedAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : null

  const createdAt = new Date(intake.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center gap-3 mb-1">
          <Link
            href="/admin/dlr/intakes"
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            ← All Intakes
          </Link>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">
            {intake.dealershipName ?? 'Unnamed Dealer'}
          </h1>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold ${getLaunchStatusColor(intake.launchStatus)}`}
          >
            {getLaunchStatusLabel(intake.launchStatus)}
          </span>
          {submittedAt && (
            <span className="text-xs text-gray-400">Submitted {submittedAt}</span>
          )}
          {!submittedAt && (
            <span className="text-xs text-gray-400 italic">Form not yet submitted</span>
          )}
          {intake.provisionedAt && (
            <span className="text-xs text-gray-400">
              Provisioned{' '}
              {new Date(intake.provisionedAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
              {intake.provisionedBy ? ` by ${intake.provisionedBy}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-8 py-6 flex gap-6">
        {/* Left: Operator Command Center + checklist */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* ── Operator Command Center ──────────────────────────────────── */}
          <section className="space-y-4">
            {/* Progress strip */}
            <ProgressStrip stepStatus={operatorStatus.stepStatus} currentStep={operatorStatus.currentStep} />

            {/* Status panel + primary CTA */}
            <div className={`rounded-xl border-2 p-5 ${
              operatorStatus.state === 'first_pilot_sent'        ? 'border-emerald-200 bg-emerald-50' :
              operatorStatus.state === 'waiting_on_number'       ? 'border-amber-300 bg-amber-50'    :
              operatorStatus.state === 'tendlc_pending' ||
              operatorStatus.state === 'waiting_on_lead_upload'  ? 'border-gray-200 bg-white'        :
                                                                   'border-blue-200 bg-blue-50'
            }`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                    Operator Command Center
                  </p>
                  <h2 className="text-xl font-bold text-gray-900 mt-0.5">
                    {operatorStatus.label}
                  </h2>
                  <p className="text-sm text-gray-700 mt-1 max-w-2xl">
                    {operatorStatus.description}
                  </p>
                </div>
                <CopySummaryButton
                  dealershipName={intake.dealershipName ?? '(unnamed)'}
                  intakeId={intake.id}
                  statusLabel={operatorStatus.label}
                  nextStepLabel={operatorStatus.primary?.label ?? '(no action — waiting)'}
                />
              </div>

              {/* Primary action — single big button */}
              {operatorStatus.primary && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {operatorStatus.primary.copyText ? (
                    <CopyButton
                      text={(() => {
                        const t = operatorStatus.primary!.copyText!
                        if (t.startsWith('http')) return t
                        // operator-status.ts uses relative paths like /intake/<token>;
                        // emit a full https URL so the dealer link is shareable.
                        return `https://dlr-sms.com${t.startsWith('/') ? '' : '/'}${t}`
                      })()}
                      label={operatorStatus.primary.label}
                      className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                    />
                  ) : operatorStatus.primary.href ? (
                    <a
                      href={operatorStatus.primary.href}
                      target={operatorStatus.primary.external ? '_blank' : undefined}
                      rel={operatorStatus.primary.external ? 'noopener noreferrer' : undefined}
                      className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {operatorStatus.primary.label}{operatorStatus.primary.external ? ' ↗' : ' →'}
                    </a>
                  ) : (
                    /* actionKey path — surfaces in the checklist below where the
                       server-action wiring already lives. Render a passive note
                       pointing operators there. */
                    <span className="text-xs text-gray-600 italic">
                      Run from the operational checklist below ({operatorStatus.primary.label}).
                    </span>
                  )}

                  {operatorStatus.nextAfter && (
                    <span className="text-xs text-gray-500">
                      Then: {operatorStatus.nextAfter}
                    </span>
                  )}
                </div>
              )}

              {!operatorStatus.primary && operatorStatus.nextAfter && (
                <p className="mt-3 text-xs text-gray-500 italic">
                  Then: {operatorStatus.nextAfter}
                </p>
              )}
            </div>
          </section>

          {/* ── 10DLC Submission Copilot (only when not yet submitted) ───── */}
          {tenDlcPending && (
            <TenDlcCopilotPanel
              intakeId={intake.id}
              audit={tendlcAudit}
              sections={tendlcSections}
              fullPacket={tendlcFull}
              campaignNarrative={tendlcNarrative}
              sampleMessagesBlock={tendlcSamples}
              initialReference={intake.tenDlcReference}
            />
          )}
          {intake.tenDlcReference && !tenDlcPending && (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
              <span className="text-gray-400">TCR reference:</span>{' '}
              <span className="font-mono font-medium text-gray-800">{intake.tenDlcReference}</span>
            </div>
          )}

          {/* ── Operational checklist (de-emphasised) ─────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Operational checklist
            </h3>
            <ChecklistPanel
              items={checklist}
              intakeId={intake.id}
              intakeToken={intake.token}
            />
          </div>
        </div>

        {/* Right: Sidebar */}
        <div
          className="w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden self-start"
        >
          <SidebarSection title="Business">
            <SidebarRow label="Rooftop Name" value={intake.dealershipName} />
            <SidebarRow label="Legal Name" value={intake.businessLegalName} />
            <SidebarRow label="EIN" value={intake.ein} />
            <div>
              <p className="text-xs text-gray-400">Website</p>
              {intake.businessWebsite ? (
                <p className="text-sm font-medium mt-0.5 break-words">
                  <ExternalLinkButton
                    href={ensureHttp(intake.businessWebsite)}
                    label={intake.businessWebsite}
                  />
                </p>
              ) : (
                <p className="text-sm font-medium text-gray-800 mt-0.5">
                  <span className="text-gray-300 italic">—</span>
                </p>
              )}
            </div>
            <SidebarRow label="Address" value={intake.businessAddress} />
          </SidebarSection>

          <SidebarSection title="Contacts">
            <SidebarRow label="Primary Contact" value={intake.primaryContactName} />
            <SidebarRow label="Email" value={intake.primaryContactEmail} />
            <SidebarRow label="Alert Email" value={intake.alertEmail} />
            <SidebarRow label="Manager Mobile" value={intake.alertPhone} />
            <div className="pt-1">
              <CopyButton text={contactBlock} label="Copy contact block" />
            </div>
          </SidebarSection>

          <SidebarSection title="Operations">
            <SidebarRow label="CRM" value={intake.crmSystem} />
            <SidebarRow label="Timezone" value={intake.timezone} />
            <SidebarRow label="Business Hours" value={intake.businessHours} />
            <SidebarRow label="Monthly Vol." value={intake.expectedMonthlyVolume?.toString()} />
          </SidebarSection>

          {/* Messaging plan — what the dealer chose in Stage 2.
              Three possible states, only one of which renders custom
              copy. Carrier-submission sample messages themselves come
              from the workflow-template library downstream, not from
              this row. */}
          <SidebarSection title="Messaging plan">
            {intake.dealerMessagingNotes ? (
              <div>
                <p className="text-xs text-gray-400 mb-1">Dealer notes</p>
                <p className="text-xs text-gray-700 leading-relaxed bg-gray-50 rounded p-2 whitespace-pre-wrap">
                  {intake.dealerMessagingNotes}
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Dealer opted out of recommended messaging and provided these
                  customizations on Stage 2.
                </p>
              </div>
            ) : (intake.sampleMessage1 || intake.sampleMessage2) ? (
              <>
                <p className="text-[11px] text-gray-400 uppercase tracking-wide">
                  Approved sample copy
                </p>
                {intake.sampleMessage1 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Message 1</p>
                    <p className="text-xs text-gray-700 leading-relaxed bg-gray-50 rounded p-2">
                      {intake.sampleMessage1}
                    </p>
                  </div>
                )}
                {intake.sampleMessage2 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Message 2</p>
                    <p className="text-xs text-gray-700 leading-relaxed bg-gray-50 rounded p-2">
                      {intake.sampleMessage2}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div>
                <p className="text-xs text-gray-700">
                  Using recommended starter messaging
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                  {intake.submittedAt
                    ? 'Dealer kept the default messaging at Stage 2 submit.'
                    : 'No customizations recorded yet — Stage 2 not submitted.'}
                </p>
              </div>
            )}
          </SidebarSection>

          {(intake.leadSourceExplanation || intake.consentExplanation) && (
            <SidebarSection title="Compliance Copy">
              {intake.leadSourceExplanation && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Lead Source</p>
                  <p className="text-xs text-gray-700 leading-relaxed line-clamp-4">
                    {intake.leadSourceExplanation}
                  </p>
                </div>
              )}
              {intake.consentExplanation && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Consent</p>
                  <p className="text-xs text-gray-700 leading-relaxed line-clamp-4">
                    {intake.consentExplanation}
                  </p>
                </div>
              )}
            </SidebarSection>
          )}

          {tenant && (
            <SidebarSection title="Tenant">
              <SidebarRow label="Tenant ID" value={tenant.id.slice(0, 8) + '…'} />
              <SidebarRow label="Slug" value={tenant.slug} />
              <SidebarRow label="SMS Number" value={tenant.smsSendingNumber} />
              <SidebarRow label="10DLC Status" value={tenant.tenDlcStatus} />
            </SidebarSection>
          )}

          <div className="p-5">
            <AdminNotesPanel intakeId={intake.id} initialNotes={intake.adminNotes} />
          </div>

          <div className="px-5 pb-4">
            <p className="text-xs text-gray-300">Created {createdAt} · ID {intake.id.slice(0, 8)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@/lib/db'
import { dealerIntakes, tenants } from '@/lib/db/schema'
import {
  computeChecklist,
  getLaunchStatusLabel,
  getLaunchStatusColor,
} from '@/lib/intake/checklist'
import { getChecklistExtras } from './actions'
import {
  ChecklistPanel,
  AdminNotesPanel,
  CopyButton,
  ExternalLinkButton,
  TenDlcSubmitActions,
} from './IntakeDetailClient'

// Format a single value-or-em-dash line for a copy block.
function packetLine(label: string, value: string | number | null | undefined): string {
  const v = value == null || value === '' ? '—' : String(value)
  return `${label}: ${v}`
}

function buildCompliancePacket(intake: typeof dealerIntakes.$inferSelect): string {
  const lines = [
    packetLine('Legal Name', intake.businessLegalName),
    packetLine('EIN', intake.ein),
    packetLine('Website', intake.businessWebsite),
    packetLine('Address', intake.businessAddress),
    packetLine('Approved Sender Name', intake.dealershipName),
    packetLine('Expected Monthly Volume', intake.expectedMonthlyVolume),
    '',
    packetLine('Primary Contact Name', intake.primaryContactName),
    packetLine('Primary Contact Email', intake.primaryContactEmail),
    packetLine('Primary Contact Phone', intake.alertPhone ?? intake.storePhone),
    '',
    '— Lead Source Explanation —',
    intake.leadSourceExplanation ?? '—',
    '',
    '— Consent Explanation —',
    intake.consentExplanation ?? '—',
  ]
  return lines.join('\n')
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

  const tenDlcStep = checklist.find(c => c.key === '10dlc_submitted')
  const tenDlcPending = tenDlcStep?.status === 'pending'

  const compliancePacket = buildCompliancePacket(intake)
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
        {/* Left: Checklist + operator actions */}
        <div className="flex-1 min-w-0 space-y-4">
          {tenDlcPending && (
            <TenDlcSubmitActions
              intakeId={intake.id}
              compliancePacket={compliancePacket}
              initialReference={intake.tenDlcReference}
            />
          )}
          {intake.tenDlcReference && !tenDlcPending && (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
              <span className="text-gray-400">TCR reference:</span>{' '}
              <span className="font-mono font-medium text-gray-800">{intake.tenDlcReference}</span>
            </div>
          )}
          <ChecklistPanel
            items={checklist}
            intakeId={intake.id}
            intakeToken={intake.token}
          />
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

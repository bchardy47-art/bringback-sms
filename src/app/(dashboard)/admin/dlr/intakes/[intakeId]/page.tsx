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
import { ChecklistPanel, AdminNotesPanel } from './IntakeDetailClient'

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
        {/* Left: Checklist */}
        <div className="flex-1 min-w-0">
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
            <SidebarRow label="Website" value={intake.businessWebsite} />
            <SidebarRow label="Address" value={intake.businessAddress} />
          </SidebarSection>

          <SidebarSection title="Contacts">
            <SidebarRow label="Primary Contact" value={intake.primaryContactName} />
            <SidebarRow label="Email" value={intake.primaryContactEmail} />
            <SidebarRow label="Alert Email" value={intake.alertEmail} />
            <SidebarRow label="Manager Mobile" value={intake.alertPhone} />
          </SidebarSection>

          <SidebarSection title="Operations">
            <SidebarRow label="CRM" value={intake.crmSystem} />
            <SidebarRow label="Timezone" value={intake.timezone} />
            <SidebarRow label="Business Hours" value={intake.businessHours} />
            <SidebarRow label="Monthly Vol." value={intake.expectedMonthlyVolume?.toString()} />
          </SidebarSection>

          {(intake.sampleMessage1 || intake.sampleMessage2) && (
            <SidebarSection title="Sample Messages">
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
            </SidebarSection>
          )}

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

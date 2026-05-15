import type { InferSelectModel } from 'drizzle-orm'
import type { dealerIntakes, tenants } from '@/lib/db/schema'

export type DealerIntake = InferSelectModel<typeof dealerIntakes>
export type Tenant = InferSelectModel<typeof tenants>

export type ChecklistStatus = 'done' | 'pending' | 'missing' | 'blocked'

export type ChecklistAction = {
  label: string
  type: 'link' | 'server_action'
  href?: string       // for type: 'link'
  actionKey?: string  // for type: 'server_action' — key the client handler dispatches on
}

export type ChecklistItem = {
  key: string
  label: string
  description: string
  status: ChecklistStatus
  action?: ChecklistAction
}

export type ChecklistExtras = {
  workflowApproved: boolean   // tenant has ≥1 workflow with approvedForLive = true
  pilotImportsExist: boolean  // tenant has pilot_lead_imports rows
  pilotCompleted: boolean     // tenant has a completed pilot_batch
}

function has(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

const STATUS_RANK: Record<string, number> = {
  submitted:       0,
  info_complete:   1,
  '10dlc_pending': 2,
  '10dlc_approved':3,
  provisioned:     4,
  pilot_ready:     5,
  live:            6,
}

export function computeChecklist(
  intake: DealerIntake,
  tenant: Tenant | null,
  extras: ChecklistExtras,
): ChecklistItem[] {
  const rank = STATUS_RANK[intake.launchStatus] ?? 0

  const businessIdentityDone =
    has(intake.dealershipName) &&
    has(intake.businessLegalName) &&
    has(intake.ein) &&
    has(intake.businessWebsite) &&
    has(intake.businessAddress)

  const contactsDone =
    has(intake.primaryContactName) &&
    has(intake.primaryContactEmail) &&
    has(intake.alertEmail) &&
    has(intake.alertPhone) // manager mobile is required

  const complianceDone =
    has(intake.leadSourceExplanation) &&
    has(intake.consentExplanation)

  const sampleMessagesDone =
    has(intake.sampleMessage1) && has(intake.sampleMessage2)

  const infoReady = businessIdentityDone && contactsDone && complianceDone && sampleMessagesDone

  return [
    {
      key: 'intake_submitted',
      label: 'Intake form submitted',
      description: 'Dealer completed and submitted the onboarding form.',
      status: intake.submittedAt ? 'done' : 'missing',
    },
    {
      key: 'business_identity',
      label: 'Business identity complete',
      description:
        'Rooftop name, legal name, EIN, website, address — all required for TCR brand registration.',
      status: businessIdentityDone
        ? 'done'
        : intake.submittedAt
        ? 'missing'
        : 'pending',
    },
    {
      key: 'contacts',
      label: 'Contacts complete',
      description:
        'Primary contact, alert email, and manager mobile number — required for revival alerts.',
      status: contactsDone
        ? 'done'
        : intake.submittedAt
        ? 'missing'
        : 'pending',
    },
    {
      key: 'compliance',
      label: 'Compliance narrative complete',
      description:
        'Lead source + consent explanation — copy-pasted verbatim into TCR campaign submission.',
      status: complianceDone
        ? 'done'
        : intake.submittedAt
        ? 'missing'
        : 'pending',
    },
    {
      key: 'sample_messages',
      label: 'Sample messages ready',
      description:
        'Two approved sample messages required for TCR campaign registration.',
      status: sampleMessagesDone
        ? 'done'
        : has(intake.sampleMessage1)
        ? 'pending'
        : intake.submittedAt
        ? 'missing'
        : 'pending',
    },
    {
      key: '10dlc_submitted',
      label: '10DLC submitted to TCR',
      description:
        'Brand + campaign registration submitted in the Telnyx portal. Approval typically takes 1–3 weeks.',
      status: rank >= 2 ? 'done' : infoReady ? 'pending' : 'blocked',
      action:
        infoReady && rank < 2
          ? { label: 'Mark as submitted', type: 'server_action', actionKey: 'mark10dlcPending' }
          : undefined,
    },
    {
      key: '10dlc_approved',
      label: '10DLC approved by carriers',
      description: 'TCR has approved the brand and campaign. You can now provision and go live.',
      status: rank >= 3 ? 'done' : rank >= 2 ? 'pending' : 'blocked',
      action:
        rank === 2
          ? { label: 'Mark as approved', type: 'server_action', actionKey: 'mark10dlcApproved' }
          : undefined,
    },
    {
      key: 'tenant_provisioned',
      label: 'Tenant provisioned in DLR',
      description:
        'Dealership account created in DLR with intake data pre-filled into tenant settings.',
      status: intake.tenantId ? 'done' : rank >= 3 ? 'pending' : 'blocked',
      action:
        !intake.tenantId && rank >= 3
          ? {
              label: 'Create tenant from intake →',
              type: 'server_action',
              actionKey: 'provisionTenant',
            }
          : undefined,
    },
    {
      key: 'number_provisioned',
      label: 'Telnyx number provisioned',
      description: 'A dedicated 10DLC phone number assigned in Telnyx and linked to this tenant.',
      status: tenant?.smsSendingNumber ? 'done' : intake.tenantId ? 'pending' : 'blocked',
      action: intake.tenantId
        ? {
            label: 'Open Telnyx portal ↗',
            type: 'link',
            href: 'https://portal.telnyx.com',
          }
        : undefined,
    },
    {
      key: 'workflow_approved',
      label: 'Workflow set up and approved',
      description:
        'At least one workflow created, copy reviewed, and approved for live sends.',
      status: extras.workflowApproved ? 'done' : intake.tenantId ? 'pending' : 'blocked',
      action:
        intake.tenantId && !extras.workflowApproved
          ? { label: 'Go to workflows ↗', type: 'link', href: '/workflows' }
          : undefined,
    },
    {
      key: 'pilot_ready',
      label: 'Pilot leads imported',
      description:
        'Dead leads uploaded to the pilot staging area and selected for the first batch.',
      status: extras.pilotImportsExist ? 'done' : intake.tenantId ? 'pending' : 'blocked',
      action:
        intake.tenantId && !extras.pilotImportsExist
          ? { label: 'Go to Pilot Leads ↗', type: 'link', href: '/admin/dlr/pilot-leads' }
          : undefined,
    },
    {
      key: 'live',
      label: 'First pilot sent 🚀',
      description: 'The first live SMS pilot batch has been completed.',
      status: extras.pilotCompleted
        ? 'done'
        : extras.pilotImportsExist
        ? 'pending'
        : 'blocked',
      action:
        extras.pilotImportsExist && !extras.pilotCompleted
          ? { label: 'Go to Pilot ↗', type: 'link', href: '/admin/dlr/live-pilot' }
          : undefined,
    },
  ]
}

// ── Display helpers ────────────────────────────────────────────────────────────

export function getLaunchStatusLabel(status: string): string {
  return (
    {
      submitted:        'Submitted',
      info_complete:    'Info Complete',
      '10dlc_pending':  '10DLC Pending',
      '10dlc_approved': '10DLC Approved',
      provisioned:      'Provisioned',
      pilot_ready:      'Pilot Ready',
      live:             '🚀 Live',
    }[status] ?? status
  )
}

export function getLaunchStatusColor(status: string): string {
  return (
    {
      submitted:        'bg-gray-100 text-gray-600',
      info_complete:    'bg-blue-100 text-blue-700',
      '10dlc_pending':  'bg-yellow-100 text-yellow-700',
      '10dlc_approved': 'bg-emerald-100 text-emerald-700',
      provisioned:      'bg-purple-100 text-purple-700',
      pilot_ready:      'bg-orange-100 text-orange-700',
      live:             'bg-green-100 text-green-700',
    }[status] ?? 'bg-gray-100 text-gray-600'
  )
}

export const STATUS_DOT: Record<ChecklistStatus, string> = {
  done:    'bg-green-500',
  pending: 'bg-yellow-400',
  missing: 'bg-red-500',
  blocked: 'bg-gray-200',
}

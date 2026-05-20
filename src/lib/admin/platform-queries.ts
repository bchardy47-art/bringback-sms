/**
 * Platform-level (cross-tenant) admin queries.
 *
 * These power the /admin/dlr "Platform Control Center" landing page. Unlike
 * src/lib/admin/dlr-queries.ts (which is tenant-scoped — useful when an admin
 * is operating inside one dealership's data), this module looks across all
 * tenants and dealer_intakes rows.
 *
 * Pure read path:
 *   - no writes
 *   - no enqueues
 *   - no Telnyx / Stripe / worker calls
 *   - no schema or migration changes
 *
 * Used by:
 *   - src/app/(dashboard)/admin/dlr/page.tsx
 */

import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  tenants,
  dealerIntakes,
  pilotBatches,
  handoffTasks,
  workflows,
} from '@/lib/db/schema'

// ── Top-line counts ────────────────────────────────────────────────────────────

export type PlatformStats = {
  activeDealerships:      number  // tenants rows (everything currently provisioned)
  intakesNeedingAction:   number  // intakes not yet provisioned/live
  tenDlcPending:          number  // intakes at 10dlc_pending OR tenants with tenDlcStatus = 'pending'
  numbersNeedingAssign:   number  // provisioned tenants without a sending number
  pilotBatchesToReview:   number  // pilot_batches in 'previewed' or 'approved' (waiting on ops)
  openHandoffsAll:        number  // handoff_tasks open + in_progress across all tenants
  urgentHandoffsAll:      number  // open + in_progress + priority='urgent'
}

// ── Per-dealer pipeline row ────────────────────────────────────────────────────

export type PipelineRow = {
  intakeId:        string
  dealershipName:  string
  launchStatus:    string             // dealer_intakes.launch_status
  tenDlcStatus:    string             // intake-level for pre-provision, tenant-level after
  numberAssigned:  boolean
  tenantId:        string | null
  tenantName:      string | null
  /** Single human-readable next action. Drives the "Today's Admin Tasks" list too. */
  nextAction:      string
  /** Where the admin should click to act on the next step. */
  nextActionHref:  string
  submittedAt:     Date | null
  createdAt:       Date
}

// ── Cross-tenant urgent handoffs ───────────────────────────────────────────────

export type PlatformHandoffRow = {
  id:               string
  tenantName:       string
  classification:   string
  priority:         string
  customerMessage:  string
  leadFirstName:    string
  leadLastName:     string
  createdAt:        Date
}

// ── Full overview returned to the page ─────────────────────────────────────────

export type PlatformOverview = {
  stats:           PlatformStats
  pipeline:        PipelineRow[]
  urgentHandoffs:  PlatformHandoffRow[]
}

// ── Main loader ────────────────────────────────────────────────────────────────

export async function getPlatformOverview(): Promise<PlatformOverview> {
  // Load every intake + tenant join in one round-trip. The intake table is small
  // (≤ low hundreds even at scale) so a single SELECT * is fine; we tabulate
  // counts in JS to keep this readable.
  const [intakeRows, tenantRows, pilotRows, handoffRows, workflowRows] = await Promise.all([
    db.select().from(dealerIntakes).orderBy(desc(dealerIntakes.createdAt)),
    db.select().from(tenants),
    db.select({
      id:           pilotBatches.id,
      tenantId:     pilotBatches.tenantId,
      status:       pilotBatches.status,
      isFirstPilot: pilotBatches.isFirstPilot,
      createdAt:    pilotBatches.createdAt,
    }).from(pilotBatches),
    db.query.handoffTasks.findMany({
      where: inArray(handoffTasks.status, ['open', 'in_progress']),
      with: { lead: true, tenant: true },
      orderBy: [
        // urgent first, then oldest first — same order the per-tenant queue uses
        sql`CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`,
        handoffTasks.createdAt,
      ],
      limit: 200,
    }),
    db.select({
      id:               workflows.id,
      tenantId:         workflows.tenantId,
      approvedForLive:  workflows.approvedForLive,
    }).from(workflows),
  ])

  const tenantById = new Map(tenantRows.map(t => [t.id, t]))

  // ── Stats ───────────────────────────────────────────────────────────────────
  const activeDealerships = tenantRows.length

  // An intake "needs action" if it's not yet at live and ops can move it forward.
  // We treat 'live' as terminal; everything else surfaces to the admin.
  const intakesNeedingAction = intakeRows.filter(i => i.launchStatus !== 'live').length

  const tenDlcPending =
    intakeRows.filter(i => i.launchStatus === '10dlc_pending').length +
    tenantRows.filter(t => t.tenDlcStatus === 'pending').length

  const numbersNeedingAssign = tenantRows.filter(t => !t.smsSendingNumber).length

  const pilotBatchesToReview = pilotRows.filter(p =>
    p.status === 'previewed' || p.status === 'approved',
  ).length

  const openHandoffsAll   = handoffRows.length
  const urgentHandoffsAll = handoffRows.filter(h => h.priority === 'urgent').length

  const stats: PlatformStats = {
    activeDealerships,
    intakesNeedingAction,
    tenDlcPending,
    numbersNeedingAssign,
    pilotBatchesToReview,
    openHandoffsAll,
    urgentHandoffsAll,
  }

  // ── Pipeline rows ───────────────────────────────────────────────────────────
  const pipeline: PipelineRow[] = intakeRows.map(intake => {
    const tenant = intake.tenantId ? tenantById.get(intake.tenantId) ?? null : null

    // 10DLC status is intake-level until provisioning, then tracks the tenant
    // row (which is what the send guard actually checks).
    const tenDlcStatus = tenant?.tenDlcStatus ?? intake.launchStatus === '10dlc_approved'
      ? (tenant?.tenDlcStatus ?? 'approved')
      : (tenant?.tenDlcStatus ?? intake.launchStatus)

    const numberAssigned = !!tenant?.smsSendingNumber

    const tenantWorkflowApproved = tenant
      ? workflowRows.some(w => w.tenantId === tenant.id && w.approvedForLive)
      : false

    const tenantPilotBatch = tenant
      ? pilotRows.find(p =>
          p.tenantId === tenant.id &&
          (p.status === 'previewed' || p.status === 'approved'),
        )
      : null

    const { label: nextAction, href: nextActionHref } = computeNextAction({
      intake,
      tenant,
      tenantWorkflowApproved,
      tenantPilotBatch,
    })

    return {
      intakeId:        intake.id,
      dealershipName:  intake.dealershipName ?? '(unnamed)',
      launchStatus:    intake.launchStatus,
      tenDlcStatus:    tenant?.tenDlcStatus ?? intake.launchStatus,
      numberAssigned,
      tenantId:        tenant?.id ?? null,
      tenantName:      tenant?.name ?? null,
      nextAction,
      nextActionHref,
      submittedAt:     intake.submittedAt ?? null,
      createdAt:       intake.createdAt,
    }
  })

  // ── Urgent handoffs (cross-tenant) ──────────────────────────────────────────
  const urgentHandoffs: PlatformHandoffRow[] = handoffRows
    .filter(h => h.priority === 'urgent')
    .slice(0, 10)
    .map(h => ({
      id:              h.id,
      tenantName:      h.tenant?.name ?? '(unknown tenant)',
      classification:  h.classification,
      priority:        h.priority,
      customerMessage: h.customerMessage,
      leadFirstName:   h.lead.firstName,
      leadLastName:    h.lead.lastName,
      createdAt:       h.createdAt,
    }))

  return { stats, pipeline, urgentHandoffs }
}

// ── Next-action computation ────────────────────────────────────────────────────
//
// The intake's launchStatus is the canonical state; we walk it from earliest
// (submitted) to latest (live) and return the first step that's still open.
// Order mirrors the checklist in src/lib/intake/checklist.ts so a row's
// "next action" is the same answer the per-intake page would give.

type NextActionInput = {
  intake: typeof dealerIntakes.$inferSelect
  tenant: typeof tenants.$inferSelect | null
  tenantWorkflowApproved: boolean
  tenantPilotBatch: { id: string; status: string } | null | undefined
}

function computeNextAction(p: NextActionInput): { label: string; href: string } {
  const { intake, tenant, tenantWorkflowApproved, tenantPilotBatch } = p
  const detailHref = `/admin/dlr/intakes/${intake.id}`

  if (!intake.submittedAt) {
    return { label: 'Send intake link', href: detailHref }
  }
  if (intake.launchStatus === 'submitted' || intake.launchStatus === 'info_complete') {
    return { label: 'Submit 10DLC to TCR', href: detailHref }
  }
  if (intake.launchStatus === '10dlc_pending') {
    return { label: 'Awaiting 10DLC approval', href: detailHref }
  }
  if (intake.launchStatus === '10dlc_approved' && !tenant) {
    return { label: 'Provision tenant', href: detailHref }
  }
  if (tenant && !tenant.smsSendingNumber) {
    return { label: 'Assign Telnyx number', href: detailHref }
  }
  if (tenant && !tenantWorkflowApproved) {
    return { label: 'Approve workflow', href: '/admin/dlr/workflows' }
  }
  if (tenantPilotBatch) {
    return { label: 'Review pilot batch', href: `/admin/dlr/pilot/${tenantPilotBatch.id}` }
  }
  if (intake.launchStatus === 'provisioned' || intake.launchStatus === 'pilot_ready') {
    return { label: 'Run first pilot', href: '/admin/dlr/live-pilot' }
  }
  if (intake.launchStatus === 'live') {
    return { label: 'Live — no action needed', href: detailHref }
  }
  return { label: 'Open intake', href: detailHref }
}

// silence unused-import warnings for tables only referenced via the schema relations / type position
void and
void eq
void isNotNull
void isNull

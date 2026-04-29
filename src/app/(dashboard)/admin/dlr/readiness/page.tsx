import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { tenants, workflows, workflowSteps } from '@/lib/db/schema'
import { runPreflight } from '@/lib/engine/preflight'
import type { TenDlcStatus } from '@/lib/db/schema'

// ── Server actions ─────────────────────────────────────────────────────────────

async function approveForLive(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return
  const tenantId = session.user.tenantId
  const tenDlcStatus = (formData.get('tenDlcStatus') as TenDlcStatus) || 'dev_override'

  const res = await fetch(
    `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/admin/dlr/tenants/${tenantId}/live-approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `next-auth.session-token=${formData.get('_token')}` },
      body: JSON.stringify({ tenDlcStatus }),
    }
  )
  if (!res.ok) console.error('live-approve failed', await res.text())
  revalidatePath('/admin/dlr/readiness')
}

async function complianceBlock(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return
  const reason = formData.get('reason') as string || 'Manual compliance block'
  await db.update(tenants).set({
    complianceBlocked: true,
    complianceBlockReason: reason,
    smsLiveApproved: false,
    updatedAt: new Date(),
  }).where(eq(tenants.id, session.user.tenantId))
  revalidatePath('/admin/dlr/readiness')
}

async function complianceUnblock() {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return
  await db.update(tenants).set({
    complianceBlocked: false,
    complianceBlockReason: null,
    updatedAt: new Date(),
  }).where(eq(tenants.id, session.user.tenantId))
  revalidatePath('/admin/dlr/readiness')
}

async function approveWorkflow(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return
  const workflowId = formData.get('workflowId') as string
  const now = new Date()
  await db.update(workflows).set({
    approvedForLive: true,
    approvedAt: now,
    approvedBy: session.user.email ?? session.user.id,
    activationStatus: 'approved',
    updatedAt: now,
  }).where(eq(workflows.id, workflowId))
  revalidatePath('/admin/dlr/readiness')
}

async function activateWorkflow(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return
  const workflowId = formData.get('workflowId') as string

  // Run preflight — activation blocked if any blocker fails
  const preflight = await runPreflight(session.user.tenantId, workflowId)
  const hardBlockers = preflight.failedBlockers.filter(c => c.id !== 'workflow_active')
  if (hardBlockers.length > 0) return // UI will show why via fresh preflight data

  const now = new Date()
  await db.update(workflows).set({
    isActive: true,
    activationStatus: 'active',
    updatedAt: now,
  }).where(eq(workflows.id, workflowId))
  revalidatePath('/admin/dlr/readiness')
}

async function pauseWorkflow(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return
  const workflowId = formData.get('workflowId') as string
  await db.update(workflows).set({
    isActive: false,
    activationStatus: 'paused',
    updatedAt: new Date(),
  }).where(eq(workflows.id, workflowId))
  revalidatePath('/admin/dlr/readiness')
}

async function setTenDlcStatus(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return
  const status = formData.get('tenDlcStatus') as TenDlcStatus
  await db.update(tenants).set({
    tenDlcStatus: status,
    updatedAt: new Date(),
  }).where(eq(tenants.id, session.user.tenantId))
  revalidatePath('/admin/dlr/readiness')
}

// ── Component helpers ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  draft:         'bg-gray-100 text-gray-600',
  preview_ready: 'bg-blue-100 text-blue-700',
  approved:      'bg-teal-100 text-teal-700',
  active:        'bg-green-100 text-green-700',
  paused:        'bg-yellow-100 text-yellow-700',
}

const DLC_COLOR: Record<string, string> = {
  not_started:  'bg-gray-100 text-gray-500',
  pending:      'bg-yellow-100 text-yellow-700',
  approved:     'bg-green-100 text-green-700',
  rejected:     'bg-red-100 text-red-700',
  exempt:       'bg-blue-100 text-blue-700',
  dev_override: 'bg-purple-100 text-purple-700',
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ReadinessPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const tenantId = session.user.tenantId

  // Load tenant
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!tenant) redirect('/admin/dlr')

  // Load all non-template workflows with steps
  const allWorkflows = await db.query.workflows.findMany({
    where: eq(workflows.tenantId, tenantId),
    with: { steps: { orderBy: [workflowSteps.position] } },
    orderBy: [workflows.createdAt],
  })

  // Tenant-level preflight
  const tenantPreflight = await runPreflight(tenantId)

  const LIVE_DLC_STATUSES: TenDlcStatus[] = ['approved', 'exempt', 'dev_override']
  const tenantReady = tenantPreflight.allowed

  return (
    <div className="px-8 py-6 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Live SMS Readiness</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Every layer must pass before live SMS can be sent. Green across the board first.
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl text-sm font-bold border ${
          tenantReady
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {tenantReady ? '✓ Tenant Ready' : '✗ Not Ready'}
        </div>
      </div>

      {/* ── Tenant Readiness Panel ──────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Tenant Readiness</h2>
            <p className="text-xs text-gray-500 mt-0.5">{tenant.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {tenant.complianceBlocked ? (
              <form action={complianceUnblock}>
                <button className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-yellow-100 text-yellow-800 hover:bg-yellow-200 transition-colors">
                  Lift Compliance Block
                </button>
              </form>
            ) : (
              <form action={complianceBlock} className="flex items-center gap-2">
                <input
                  name="reason"
                  placeholder="Block reason (required)"
                  className="px-2 py-1 text-xs border border-gray-200 rounded-lg w-48"
                  required
                />
                <button className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
                  Compliance Block
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Preflight checklist */}
        <div className="divide-y divide-gray-50">
          {tenantPreflight.checks.map(check => (
            <div key={check.id} className="px-6 py-3 flex items-start gap-3">
              <span className={`mt-0.5 w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                check.passed ? 'bg-green-100 text-green-700' : check.isBlocker ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
              }`}>
                {check.passed ? '✓' : check.isBlocker ? '✗' : '⚠'}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold ${check.passed ? 'text-gray-700' : check.isBlocker ? 'text-red-700' : 'text-yellow-700'}`}>
                  {check.label}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{check.detail}</p>
              </div>
              {!check.passed && check.isBlocker && (
                <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex-shrink-0">
                  blocker
                </span>
              )}
            </div>
          ))}
        </div>

        {/* 10DLC status selector */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            10DLC Status
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${DLC_COLOR[tenant.tenDlcStatus] ?? 'bg-gray-100 text-gray-600'}`}>
              Current: {tenant.tenDlcStatus.replace('_', ' ')}
            </span>
            <form action={setTenDlcStatus} className="flex items-center gap-2">
              <select
                name="tenDlcStatus"
                defaultValue={tenant.tenDlcStatus}
                className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white"
              >
                {(['not_started','pending','approved','rejected','exempt','dev_override'] as TenDlcStatus[]).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button className="px-3 py-1 text-xs font-semibold rounded-lg bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
                Update
              </button>
            </form>
          </div>
        </div>

        {/* Live approve button */}
        <div className="px-6 py-4 border-t border-gray-100">
          {tenant.smsLiveApproved ? (
            <div className="flex items-center gap-2 text-xs text-green-700">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              Live SMS approved
              {tenant.liveActivatedAt && (
                <span className="text-gray-400">
                  · activated {new Date(tenant.liveActivatedAt).toLocaleDateString()}
                  {tenant.liveActivatedBy && ` by ${tenant.liveActivatedBy}`}
                </span>
              )}
            </div>
          ) : (
            <form action={approveForLive} className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs text-gray-500">
                  Grants live-SMS permission to this tenant. 10DLC status must be approved, exempt, or dev_override.
                </p>
              </div>
              <input type="hidden" name="tenDlcStatus" value={
                LIVE_DLC_STATUSES.includes(tenant.tenDlcStatus as TenDlcStatus)
                  ? tenant.tenDlcStatus
                  : 'dev_override'
              } />
              <button
                disabled={tenant.complianceBlocked}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Approve for Live SMS
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ── Workflow Activation Panel ───────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Workflow Activation</h2>
        <div className="space-y-4">
          {allWorkflows.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
              No workflows found. Seed templates first via the Workflow Library page.
            </div>
          ) : (
            allWorkflows.map(async (wf) => {
              const wfPreflight = await runPreflight(tenantId, wf.id)
              const sendSteps = wf.steps.filter(s => s.type === 'send_sms')

              return (
                <WorkflowActivationCard
                  key={wf.id}
                  wf={wf}
                  preflight={wfPreflight}
                  sendStepCount={sendSteps.length}
                  approveWorkflow={approveWorkflow}
                  activateWorkflow={activateWorkflow}
                  pauseWorkflow={pauseWorkflow}
                />
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

type Wf = {
  id: string
  name: string
  key: string | null
  isActive: boolean
  isTemplate: boolean
  approvedForLive: boolean
  approvedAt: Date | null
  approvedBy: string | null
  activationStatus: string
  requiresOptOutLanguage: boolean
  manualReviewRequired: boolean
}

function WorkflowActivationCard({
  wf,
  preflight,
  sendStepCount,
  approveWorkflow,
  activateWorkflow,
  pauseWorkflow,
}: {
  wf: Wf
  preflight: Awaited<ReturnType<typeof runPreflight>>
  sendStepCount: number
  approveWorkflow: (fd: FormData) => Promise<void>
  activateWorkflow: (fd: FormData) => Promise<void>
  pauseWorkflow: (fd: FormData) => Promise<void>
}) {
  const wfBlockers = preflight.failedBlockers.filter(c => c.id !== 'workflow_active')
  const canActivate = wfBlockers.length === 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between gap-4 border-b border-gray-100">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{wf.name}</p>
          {wf.key && (
            <span className="text-xs font-mono text-gray-400 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
              {wf.key}
            </span>
          )}
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[wf.activationStatus] ?? 'bg-gray-100 text-gray-600'}`}>
            {wf.activationStatus}
          </span>
          {wf.approvedForLive && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">
              ✓ approved
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 flex-shrink-0">{sendStepCount} messages</p>
      </div>

      {/* Per-workflow preflight checks */}
      <div className="px-5 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {preflight.checks
          .filter(c => ['workflow_active','workflow_approved','opt_out_language','preview_reviewed'].includes(c.id))
          .map(check => (
            <div key={check.id} className="flex items-start gap-2">
              <span className={`mt-0.5 text-xs font-bold flex-shrink-0 ${
                check.passed ? 'text-green-600' : check.isBlocker ? 'text-red-600' : 'text-yellow-600'
              }`}>
                {check.passed ? '✓' : check.isBlocker ? '✗' : '⚠'}
              </span>
              <div>
                <p className="text-xs font-medium text-gray-700">{check.label}</p>
                <p className="text-xs text-gray-400 leading-snug">{check.detail}</p>
              </div>
            </div>
          ))
        }
      </div>

      {/* Tenant-level blockers affecting this workflow */}
      {preflight.failedBlockers.filter(c => !['workflow_active','workflow_approved','opt_out_language','preview_reviewed'].includes(c.id)).length > 0 && (
        <div className="mx-5 mb-3 p-3 bg-red-50 border border-red-100 rounded-lg">
          <p className="text-xs font-semibold text-red-700 mb-1">Tenant-level blockers must be resolved first:</p>
          <ul className="space-y-0.5">
            {preflight.failedBlockers
              .filter(c => !['workflow_active','workflow_approved','opt_out_language','preview_reviewed'].includes(c.id))
              .map(c => (
                <li key={c.id} className="text-xs text-red-600">× {c.label} — {c.detail}</li>
              ))
            }
          </ul>
        </div>
      )}

      {/* Action buttons */}
      <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex items-center gap-3 flex-wrap">
        {/* Approve */}
        {!wf.approvedForLive && (
          <form action={approveWorkflow}>
            <input type="hidden" name="workflowId" value={wf.id} />
            <button className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors">
              Approve Message Copy
            </button>
          </form>
        )}

        {/* Activate */}
        {!wf.isActive && (
          <form action={activateWorkflow}>
            <input type="hidden" name="workflowId" value={wf.id} />
            <button
              disabled={!canActivate}
              title={canActivate ? 'Activate workflow' : wfBlockers.map(b => b.label).join(', ')}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Activate
            </button>
          </form>
        )}

        {/* Pause */}
        {wf.isActive && (
          <form action={pauseWorkflow}>
            <input type="hidden" name="workflowId" value={wf.id} />
            <button className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-yellow-100 text-yellow-800 hover:bg-yellow-200 transition-colors">
              Pause
            </button>
          </form>
        )}

        {/* Approval metadata */}
        {wf.approvedForLive && wf.approvedAt && (
          <span className="text-xs text-gray-400">
            Approved {new Date(wf.approvedAt).toLocaleDateString()}{wf.approvedBy ? ` by ${wf.approvedBy}` : ''}
          </span>
        )}

        {!canActivate && !wf.isActive && (
          <span className="text-xs text-red-500">
            {wfBlockers.length} blocker{wfBlockers.length !== 1 ? 's' : ''} remaining
          </span>
        )}
      </div>
    </div>
  )
}

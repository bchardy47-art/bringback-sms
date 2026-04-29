import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  pilotBatches, pilotBatchLeads, workflowEnrollments, workflowSteps,
} from '@/lib/db/schema'
import { runBatchPreview } from '@/lib/pilot/preview'
import { runPreflight } from '@/lib/engine/preflight'

// ── Server Actions ─────────────────────────────────────────────────────────────

async function runPreviewAction(formData: FormData) {
  'use server'
  const batchId = formData.get('batchId') as string
  await runBatchPreview(batchId)
  revalidatePath(`/admin/dlr/pilot/${batchId}`)
}

async function approveAction(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return
  const batchId = formData.get('batchId') as string
  const now = new Date()
  await db.update(pilotBatches).set({
    status: 'approved',
    approvedBy: session.user.email ?? session.user.id,
    approvedAt: now,
    updatedAt: now,
  }).where(eq(pilotBatches.id, batchId))
  revalidatePath(`/admin/dlr/pilot/${batchId}`)
}

async function startAction(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return
  const batchId = formData.get('batchId') as string

  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch || !['approved','paused'].includes(batch.status)) return

  // Gate: preflight
  const preflight = await runPreflight(session.user.tenantId, batch.workflowId)
  if (!preflight.allowed) return // UI shows readiness state

  const now = new Date()
  const pendingLeads = batch.leads.filter(l => l.approvedForSend && l.sendStatus === 'pending' && !l.enrollmentId)

  for (const batchLead of pendingLeads) {
    const [enrollment] = await db.insert(workflowEnrollments).values({
      workflowId: batch.workflowId,
      leadId: batchLead.leadId,
      status: 'active',
      currentStepPosition: 0,
      enrolledAt: now,
    }).returning()
    await db.update(pilotBatchLeads)
      .set({ enrollmentId: enrollment.id, updatedAt: now })
      .where(eq(pilotBatchLeads.id, batchLead.id))
  }

  await db.update(pilotBatches).set({
    status: 'sending',
    startedAt: batch.startedAt ?? now,
    updatedAt: now,
  }).where(eq(pilotBatches.id, batchId))
  revalidatePath(`/admin/dlr/pilot/${batchId}`)
}

async function pauseAction(formData: FormData) {
  'use server'
  const batchId = formData.get('batchId') as string
  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch || batch.status !== 'sending') return

  const enrollmentIds = batch.leads.map(l => l.enrollmentId).filter(Boolean) as string[]
  if (enrollmentIds.length > 0) {
    for (const eid of enrollmentIds) {
      await db.update(workflowEnrollments)
        .set({ status: 'paused' })
        .where(and(eq(workflowEnrollments.id, eid), eq(workflowEnrollments.status, 'active')))
    }
  }
  await db.update(pilotBatches).set({ status: 'paused', updatedAt: new Date() }).where(eq(pilotBatches.id, batchId))
  revalidatePath(`/admin/dlr/pilot/${batchId}`)
}

async function cancelAction(formData: FormData) {
  'use server'
  const batchId = formData.get('batchId') as string
  const reason = (formData.get('cancelReason') as string) || 'Manual cancellation'
  const now = new Date()

  const batch = await db.query.pilotBatches.findFirst({
    where: eq(pilotBatches.id, batchId),
    with: { leads: true },
  })
  if (!batch) return

  const enrollmentIds = batch.leads.map(l => l.enrollmentId).filter(Boolean) as string[]
  for (const eid of enrollmentIds) {
    await db.update(workflowEnrollments).set({
      status: 'cancelled',
      stopReason: `pilot_cancelled: ${reason}`,
      stoppedAt: now,
    }).where(eq(workflowEnrollments.id, eid))
  }

  await db.update(pilotBatchLeads).set({
    sendStatus: 'cancelled',
    skipReason: `batch_cancelled: ${reason}`,
    updatedAt: now,
  }).where(and(eq(pilotBatchLeads.batchId, batchId), eq(pilotBatchLeads.sendStatus, 'pending')))

  await db.update(pilotBatches).set({
    status: 'cancelled',
    cancelledAt: now,
    cancelReason: reason,
    updatedAt: now,
  }).where(eq(pilotBatches.id, batchId))
  revalidatePath(`/admin/dlr/pilot/${batchId}`)
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  previewed: 'bg-blue-100 text-blue-700',
  approved:  'bg-teal-100 text-teal-700',
  sending:   'bg-green-100 text-green-700',
  paused:    'bg-yellow-100 text-yellow-700',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function PilotBatchDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const batch = await db.query.pilotBatches.findFirst({
    where: and(
      eq(pilotBatches.id, params.id),
      eq(pilotBatches.tenantId, session.user.tenantId)
    ),
    with: {
      leads: {
        with: { lead: true },
        orderBy: [pilotBatchLeads.createdAt],
      },
      workflow: {
        with: { steps: { orderBy: [workflowSteps.position] } },
      },
    },
  })

  if (!batch) redirect('/admin/dlr/pilot')

  // Preflight for start-gate display
  const preflight = await runPreflight(session.user.tenantId, batch.workflowId)
  const preflightBlockers = preflight.failedBlockers

  const eligibleLeads = batch.leads.filter(l => l.eligibilityResult?.eligible)
  const ineligibleLeads = batch.leads.filter(l => l.eligibilityResult && !l.eligibilityResult.eligible)
  const pendingLeads = batch.leads.filter(l => l.approvedForSend && l.sendStatus === 'pending')

  const canPreview  = !['sending','completed','cancelled'].includes(batch.status)
  const canApprove  = batch.status === 'previewed' && eligibleLeads.length > 0
  const canStart    = ['approved','paused'].includes(batch.status) && preflightBlockers.length === 0 && pendingLeads.length > 0
  const canPause    = batch.status === 'sending'
  const canCancel   = ['draft','previewed','approved','sending','paused'].includes(batch.status)

  return (
    <div className="px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{batch.workflow?.name ?? 'Pilot Batch'}</h1>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[batch.status] ?? 'bg-gray-100'}`}>
              {batch.status}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5 font-mono">{batch.id}</p>
          {batch.approvedBy && (
            <p className="text-xs text-gray-500 mt-0.5">
              Approved by {batch.approvedBy}
              {batch.approvedAt ? ` on ${new Date(batch.approvedAt).toLocaleDateString()}` : ''}
            </p>
          )}
        </div>
        {/* Results summary */}
        <div className="grid grid-cols-4 gap-3 text-center">
          {[
            { label: 'Sent',     value: batch.liveSendCount,  color: 'text-green-700' },
            { label: 'Blocked',  value: batch.blockedCount,   color: 'text-gray-400' },
            { label: 'Replies',  value: batch.replyCount,     color: 'text-blue-600' },
            { label: 'Handoffs', value: batch.handoffCount,   color: 'text-orange-500' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-lg border border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-lg font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action bar */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-3 flex-wrap">
        {/* Preview */}
        {canPreview && (
          <form action={runPreviewAction}>
            <input type="hidden" name="batchId" value={batch.id} />
            <button className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
              {batch.status === 'draft' ? 'Run Dry-Run Preview' : 'Re-run Preview'}
            </button>
          </form>
        )}

        {/* Approve */}
        {canApprove && (
          <form action={approveAction}>
            <input type="hidden" name="batchId" value={batch.id} />
            <button className="px-4 py-2 text-xs font-bold rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors">
              Approve Batch
            </button>
          </form>
        )}

        {/* Start */}
        {['approved','paused'].includes(batch.status) && (
          <form action={startAction}>
            <input type="hidden" name="batchId" value={batch.id} />
            <button
              disabled={!canStart}
              title={canStart ? 'Start sending' : preflightBlockers.map(b => b.label).join('; ')}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {batch.status === 'paused' ? 'Resume Sending' : 'Start Sending'}
            </button>
          </form>
        )}

        {/* Pause */}
        {canPause && (
          <form action={pauseAction}>
            <input type="hidden" name="batchId" value={batch.id} />
            <button className="px-4 py-2 text-xs font-semibold rounded-lg bg-yellow-100 text-yellow-800 hover:bg-yellow-200 transition-colors">
              Pause
            </button>
          </form>
        )}

        {/* Cancel */}
        {canCancel && (
          <form action={cancelAction} className="flex items-center gap-2 ml-auto">
            <input type="hidden" name="batchId" value={batch.id} />
            <input
              name="cancelReason"
              placeholder="Cancel reason (optional)"
              className="px-2 py-1 text-xs border border-gray-200 rounded-lg"
            />
            <button className="px-3 py-2 text-xs font-semibold rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
              Cancel Batch
            </button>
          </form>
        )}
      </div>

      {/* Preflight blockers warning */}
      {['approved','paused'].includes(batch.status) && preflightBlockers.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <p className="text-xs font-bold text-red-700 mb-2">
            Cannot start — readiness checks failing:
          </p>
          <ul className="space-y-1">
            {preflightBlockers.map(b => (
              <li key={b.id} className="text-xs text-red-600 flex gap-1.5">
                <span>×</span><span>{b.label} — {b.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Per-lead preview table */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Leads ({batch.leads.length} / {batch.maxLeadCount})
        </h2>

        {batch.leads.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
            No leads in this batch.
          </div>
        ) : (
          <div className="space-y-4">
            {batch.leads.map(batchLead => {
              const lead = batchLead.lead
              const eligible = batchLead.eligibilityResult?.eligible
              const hasPreview = !!batchLead.previewMessages?.length

              return (
                <div key={batchLead.id} className={`bg-white rounded-xl border overflow-hidden ${
                  eligible === false ? 'border-red-100' : 'border-gray-200'
                }`}>
                  {/* Lead header */}
                  <div className="px-5 py-3 flex items-center gap-3 border-b border-gray-100">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      eligible === undefined ? 'bg-gray-100 text-gray-400' :
                      eligible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}>
                      {eligible === undefined ? '?' : eligible ? '✓' : '✗'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {lead?.firstName} {lead?.lastName}
                        <span className="ml-2 text-xs font-normal text-gray-400">{lead?.phone}</span>
                      </p>
                      <p className="text-xs text-gray-400">{lead?.state} · {lead?.vehicleOfInterest ?? 'no vehicle'}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        batchLead.sendStatus === 'sent' ? 'bg-green-100 text-green-700' :
                        batchLead.sendStatus === 'skipped' ? 'bg-gray-100 text-gray-500' :
                        batchLead.sendStatus === 'cancelled' ? 'bg-red-100 text-red-600' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {batchLead.sendStatus}
                      </span>
                      {batchLead.enrollmentId && (
                        <span className="text-xs text-blue-500 font-mono">enrolled</span>
                      )}
                    </div>
                  </div>

                  {/* Ineligibility reason */}
                  {eligible === false && batchLead.skipReason && (
                    <div className="px-5 py-2 bg-red-50 text-xs text-red-600">
                      Excluded: {batchLead.skipReason}
                    </div>
                  )}

                  {/* Message previews */}
                  {hasPreview && eligible && (
                    <div className="px-5 py-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Message Preview
                      </p>
                      {batchLead.previewMessages!
                        .filter(m => m.type === 'send_sms')
                        .map(m => (
                          <div
                            key={m.position}
                            className={`rounded-lg border p-3 ${m.usedFallback ? 'border-yellow-200 bg-yellow-50' : 'border-gray-100 bg-gray-50'}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-gray-500">{m.label}</span>
                              {m.usedFallback && (
                                <span className="text-xs font-semibold text-yellow-600 bg-yellow-100 px-1.5 py-0.5 rounded">
                                  fallback copy
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-800 leading-relaxed">{m.rendered}</p>
                          </div>
                        ))
                      }
                    </div>
                  )}

                  {/* Reply classification */}
                  {batchLead.replyClassification && (
                    <div className="px-5 py-2 bg-blue-50 border-t border-blue-100 text-xs text-blue-700">
                      Reply: <span className="font-semibold">{batchLead.replyClassification}</span>
                      {batchLead.handoffTaskId && (
                        <span className="ml-2 text-orange-600">→ handoff created</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Dry-run summary stats */}
      {batch.dryRunSummary && (
        <section className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Dry-Run Summary
          </p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Generated</p>
              <p className="font-semibold">{new Date(batch.dryRunSummary.generatedAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Eligible</p>
              <p className="font-semibold text-green-700">{batch.dryRunSummary.eligibleCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Excluded</p>
              <p className="font-semibold text-red-600">{batch.dryRunSummary.ineligibleCount}</p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

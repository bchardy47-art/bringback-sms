import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { workflows, workflowSteps } from '@/lib/db/schema'
import { WORKFLOW_TEMPLATE_BY_KEY } from '@/lib/workflows/templates'
import { previewWorkflow } from '@/lib/workflows/preview'
import type { SendSmsConfig, WorkflowTriggerConfig } from '@/lib/db/schema'

const TRIGGER_LABEL: Record<string, string> = {
  stale:    'Stale lead',
  orphaned: 'Orphan customer',
  no_show:  'No-show',
  manual:   'Manual / batch',
}

const TRIGGER_COLOR: Record<string, string> = {
  stale:    'bg-yellow-100 text-yellow-700',
  orphaned: 'bg-purple-100 text-purple-700',
  no_show:  'bg-orange-100 text-orange-700',
  manual:   'bg-blue-100 text-blue-700',
}

// Sample lead for previewing merge field rendering
const SAMPLE_LEAD_WITH_VEHICLE = {
  firstName:         'Alex',
  lastName:          'Rivera',
  dealershipName:    'Demo Dealership',
  vehicleOfInterest: '2024 Toyota Camry XSE',
  salespersonName:   'Jamie Park',
}

const SAMPLE_LEAD_NO_VEHICLE = {
  firstName:      'Sam',
  lastName:       'Chen',
  dealershipName: 'Demo Dealership',
  vehicleOfInterest: null,
  salespersonName:   null,
}

export default async function WorkflowLibraryPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const tenantId = session.user.tenantId

  // Load all workflows for this tenant (templates + live), with steps
  const allWorkflows = await db.query.workflows.findMany({
    where: eq(workflows.tenantId, tenantId),
    with: { steps: { orderBy: [workflowSteps.position] } },
    orderBy: [workflows.createdAt],
  })

  const templateWorkflows = allWorkflows.filter((w) => w.isTemplate)
  const liveWorkflows     = allWorkflows.filter((w) => !w.isTemplate)

  return (
    <div className="px-8 py-6 space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Workflow Library</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pre-built revival templates — inactive by default. Activate a template to start enrolling leads.
        </p>
      </div>

      {/* Template count summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard label="Templates"    value={templateWorkflows.length} />
        <SummaryCard label="Active"       value={templateWorkflows.filter(w => w.isActive).length}  color="text-green-600" />
        <SummaryCard label="Inactive"     value={templateWorkflows.filter(w => !w.isActive).length} color="text-gray-400" />
        <SummaryCard label="Live workflows" value={liveWorkflows.length} />
      </div>

      {/* Template library */}
      {templateWorkflows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
          No templates found. Run <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">scripts/seed-workflow-templates.ts</code> to seed the library.
        </div>
      ) : (
        <div className="space-y-6">
          {templateWorkflows.map((wf) => {
            const meta = wf.key ? WORKFLOW_TEMPLATE_BY_KEY[wf.key] : null
            const config = (wf.triggerConfig ?? {}) as WorkflowTriggerConfig
            const sendSteps = wf.steps.filter(s => s.type === 'send_sms')
            const stepCount = wf.steps.length

            // Preview renders — with and without vehicle
            const previewWith    = previewWorkflow(wf.steps.map(s => ({
              position: s.position,
              type: s.type,
              config: s.config as SendSmsConfig,
            })), SAMPLE_LEAD_WITH_VEHICLE)
            const previewWithout = previewWorkflow(wf.steps.map(s => ({
              position: s.position,
              type: s.type,
              config: s.config as SendSmsConfig,
            })), SAMPLE_LEAD_NO_VEHICLE)

            return (
              <div key={wf.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm font-bold text-gray-900">{wf.name}</h2>
                      {wf.key && (
                        <span className="text-xs font-mono text-gray-400 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
                          {wf.key}
                        </span>
                      )}
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${TRIGGER_COLOR[wf.triggerType] ?? 'bg-gray-100 text-gray-600'}`}>
                        {TRIGGER_LABEL[wf.triggerType] ?? wf.triggerType}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${wf.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${wf.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {wf.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {wf.description && (
                      <p className="text-xs text-gray-500 mt-1">{wf.description}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 text-xs text-gray-400">
                    <p>{stepCount} steps · {sendSteps.length} messages</p>
                    {config.daysInactive && (
                      <p>Trigger at {config.daysInactive}d inactive</p>
                    )}
                    {config.cooldownDays && (
                      <p>{config.cooldownDays}d cooldown</p>
                    )}
                  </div>
                </div>

                {/* Metadata row */}
                {meta && (
                  <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Lead Source</p>
                      <p className="text-gray-700">{meta.triggerConfig.intendedLeadSource}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Required Fields</p>
                      <p className="font-mono text-gray-700">{meta.triggerConfig.requiredMergeFields?.join(', ')}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Optional Fields</p>
                      <p className="font-mono text-gray-700">
                        {meta.triggerConfig.optionalMergeFields?.length
                          ? meta.triggerConfig.optionalMergeFields.join(', ')
                          : '—'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Message previews — with vehicle context */}
                <div className="px-6 py-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Preview — with vehicle context
                    <span className="ml-2 text-gray-400 normal-case font-normal">({SAMPLE_LEAD_WITH_VEHICLE.firstName}, {SAMPLE_LEAD_WITH_VEHICLE.vehicleOfInterest})</span>
                  </p>
                  {previewWith.filter(s => s.type === 'send_sms').map((step) => (
                    <MessagePreview key={step.position} step={step} />
                  ))}
                </div>

                {/* Message previews — without vehicle */}
                {(meta?.triggerConfig.optionalMergeFields?.includes('vehicleOfInterest')) && (
                  <div className="px-6 pb-4 space-y-3 border-t border-gray-50 pt-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Preview — no vehicle context (fallback copy)
                      <span className="ml-2 text-gray-400 normal-case font-normal">({SAMPLE_LEAD_NO_VEHICLE.firstName}, no vehicleOfInterest)</span>
                    </p>
                    {previewWithout.filter(s => s.type === 'send_sms').map((step) => (
                      <MessagePreview key={step.position} step={step} />
                    ))}
                  </div>
                )}

                {/* Stop / handoff conditions */}
                {meta && (
                  <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-gray-500 uppercase tracking-wider mb-1">Stop Conditions</p>
                      <ul className="space-y-0.5">
                        {meta.triggerConfig.stopConditions?.map((c, i) => (
                          <li key={i} className="text-gray-600 flex gap-1.5">
                            <span className="text-red-400 shrink-0">×</span>{c}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-500 uppercase tracking-wider mb-1">Handoff Conditions</p>
                      <ul className="space-y-0.5">
                        {meta.triggerConfig.handoffConditions?.map((c, i) => (
                          <li key={i} className="text-gray-600 flex gap-1.5">
                            <span className="text-orange-400 shrink-0">→</span>{c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Live workflows (non-template) */}
      {liveWorkflows.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Live Workflows (non-template)</h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['Name', 'Trigger', 'Steps', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {liveWorkflows.map(wf => (
                  <tr key={wf.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">{wf.name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${TRIGGER_COLOR[wf.triggerType] ?? ''}`}>
                        {TRIGGER_LABEL[wf.triggerType] ?? wf.triggerType}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{wf.steps.length} steps</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-semibold ${wf.isActive ? 'text-green-600' : 'text-gray-400'}`}>
                        {wf.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function MessagePreview({
  step,
}: {
  step: { position: number; label: string; rendered: string | null; usedFallback: boolean; valid: boolean }
}) {
  return (
    <div className={`rounded-lg border p-3 ${step.usedFallback ? 'border-yellow-200 bg-yellow-50' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-500">{step.label}</span>
        {step.usedFallback && (
          <span className="text-xs font-semibold text-yellow-600 bg-yellow-100 px-1.5 py-0.5 rounded">
            using fallback copy
          </span>
        )}
      </div>
      <p className="text-sm text-gray-800 leading-relaxed">
        {step.rendered}
      </p>
    </div>
  )
}

function SummaryCard({
  label, value, color,
}: {
  label: string; value: number; color?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

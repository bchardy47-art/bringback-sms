import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq, inArray } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { leads, pilotBatchLeads, pilotBatches, workflows, HARD_PILOT_CAP } from '@/lib/db/schema'

async function createBatch(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return

  const workflowId = formData.get('workflowId') as string
  const leadIdsRaw = formData.get('leadIds') as string
  const maxLeadCount = Math.min(
    parseInt(formData.get('maxLeadCount') as string || '10', 10),
    HARD_PILOT_CAP
  )

  const leadIds = leadIdsRaw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, maxLeadCount)

  if (!workflowId || leadIds.length === 0) return

  // Verify leads belong to tenant
  const validLeads = await db.query.leads.findMany({
    where: inArray(leads.id, leadIds),
  })
  const tenantLeadIds = validLeads
    .filter(l => l.tenantId === session.user.tenantId)
    .map(l => l.id)

  if (tenantLeadIds.length === 0) return

  const [batch] = await db
    .insert(pilotBatches)
    .values({
      tenantId: session.user.tenantId,
      workflowId,
      status: 'draft',
      maxLeadCount,
      createdBy: session.user.email ?? session.user.id,
    })
    .returning()

  await db.insert(pilotBatchLeads).values(
    tenantLeadIds.map(leadId => ({ batchId: batch.id, leadId, sendStatus: 'pending' as const }))
  )

  redirect(`/admin/dlr/pilot/${batch.id}`)
}

async function autoSuggestLeads(formData: FormData) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session) return

  const workflowId = formData.get('workflowId') as string
  const maxCount = Math.min(
    parseInt(formData.get('maxLeadCount') as string || '10', 10),
    HARD_PILOT_CAP
  )
  if (!workflowId) return

  // Find stale/orphaned leads that haven't been enrolled in this workflow
  const suggestedLeads = await db.query.leads.findMany({
    where: eq(leads.tenantId, session.user.tenantId),
    limit: maxCount * 3, // over-fetch to account for filtering
  })

  // Redirect to new page with suggested lead IDs
  const ids = suggestedLeads
    .filter(l => !l.doNotAutomate && !l.isTest && ['stale', 'orphaned', 'revival_eligible'].includes(l.state))
    .slice(0, maxCount)
    .map(l => l.id)
    .join(',')

  redirect(`/admin/dlr/pilot/new?suggested=${ids}&workflowId=${workflowId}&max=${maxCount}`)
}

export default async function NewBatchPage({
  searchParams,
}: {
  searchParams: { suggested?: string; workflowId?: string; max?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const tenantId = session.user.tenantId

  const availableWorkflows = await db.query.workflows.findMany({
    where: eq(workflows.tenantId, tenantId),
    orderBy: [workflows.name],
  })

  // Auto-suggested leads (from query params)
  const suggestedIds = searchParams.suggested?.split(',').filter(Boolean) ?? []
  const suggestedLeads = suggestedIds.length > 0
    ? await db.query.leads.findMany({
        where: inArray(leads.id, suggestedIds),
      })
    : []

  // All eligible-ish leads for manual selection
  const recentLeads = await db.query.leads.findMany({
    where: eq(leads.tenantId, tenantId),
    limit: 100,
    orderBy: [leads.createdAt],
  })

  return (
    <div className="px-8 py-6 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">New Pilot Batch</h1>
      <p className="text-sm text-gray-500 mb-6">
        Select a workflow and up to {HARD_PILOT_CAP} leads. You'll run a dry-run preview before any sends.
      </p>

      <form action={createBatch} className="space-y-5">
        {/* Workflow selector */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Workflow</label>
          <select
            name="workflowId"
            defaultValue={searchParams.workflowId ?? ''}
            required
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="" disabled>Select a workflow…</option>
            {availableWorkflows.map(wf => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
                {wf.key ? ` (${wf.key})` : ''}
                {wf.isActive ? ' ✓' : ' — inactive'}
              </option>
            ))}
          </select>
        </div>

        {/* Max lead count */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Max leads (hard cap: {HARD_PILOT_CAP})
          </label>
          <input
            type="number"
            name="maxLeadCount"
            defaultValue={searchParams.max ?? '10'}
            min={1}
            max={HARD_PILOT_CAP}
            className="w-32 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>

        {/* Lead IDs */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Lead UUIDs (comma or newline separated)
          </label>
          {suggestedLeads.length > 0 && (
            <div className="mb-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-xs font-semibold text-blue-700 mb-1">
                {suggestedLeads.length} suggested leads (stale/eligible, no DNA):
              </p>
              <ul className="space-y-0.5">
                {suggestedLeads.map(l => (
                  <li key={l.id} className="text-xs text-blue-600 font-mono">
                    {l.id} — {l.firstName} {l.lastName} ({l.state})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <textarea
            name="leadIds"
            rows={6}
            placeholder="Paste lead UUIDs here, one per line or comma-separated"
            defaultValue={suggestedLeads.map(l => l.id).join('\n')}
            className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            required
          />
          <p className="text-xs text-gray-400 mt-1">
            Or use the auto-suggest form below to find eligible leads automatically.
          </p>
        </div>

        <button
          type="submit"
          className="px-5 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          Create Batch (Draft)
        </button>
      </form>

      {/* Auto-suggest */}
      <div className="mt-8 pt-6 border-t border-gray-100">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
          Auto-suggest eligible leads
        </h2>
        <form action={autoSuggestLeads} className="flex items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Workflow</label>
            <select
              name="workflowId"
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            >
              <option value="">Select…</option>
              {availableWorkflows.map(wf => (
                <option key={wf.id} value={wf.id}>{wf.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Count</label>
            <input
              type="number"
              name="maxLeadCount"
              defaultValue="5"
              min={1}
              max={HARD_PILOT_CAP}
              className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            Suggest Leads
          </button>
        </form>
      </div>
    </div>
  )
}

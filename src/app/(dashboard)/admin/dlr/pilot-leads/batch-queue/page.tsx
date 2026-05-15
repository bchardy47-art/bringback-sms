/**
 * /admin/dlr/pilot-leads/batch-queue
 *
 * Landing page after "Create Recommended Pilot" creates multiple draft batches.
 * Receives: ?ids=batchId1,batchId2,batchId3 — scoped to the caller's tenant.
 *
 * Shows all newly created batches in one place so the operator knows exactly
 * how many batches were created, which age buckets they cover, and where to
 * review each one. Replaces the old behaviour of navigating to only batches[0].
 */

import { db } from '@/lib/db'
import { workflows } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import Link from 'next/link'

// Mirrors AGE_BUCKET_LABELS from schema.ts. Kept inline because this page
// renders a simple string lookup against workflow.ageBucket. Bucket A reads
// as 0–29 days for visual consistency with the 30-day windows on B/C/D;
// leads under LEAD_HOLD_DAYS are still held by the classifier.
const BUCKET_LABEL: Record<string, string> = {
  a: '0–29 days',
  b: '30–59 days',
  c: '60–89 days',
  d: '90+ days',
}

type Props = {
  searchParams: { ids?: string }
}

export default async function BatchQueuePage({ searchParams }: Props) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect('/login')
  if (session.user.role !== 'admin') redirect('/')

  const tenantId  = session.user.tenantId
  const rawIds    = (searchParams.ids ?? '').split(',').map(s => s.trim()).filter(Boolean)

  // Load the requested batches (with lead counts, scoped to tenantId for safety)
  const batches = rawIds.length > 0
    ? await db.query.pilotBatches.findMany({
        where: (pb, { and, inArray: inArr, eq: eq_ }) =>
          and(inArr(pb.id, rawIds), eq_(pb.tenantId, tenantId)),
        with: { leads: true },
      })
    : []

  // Load workflow names
  const workflowIds = batches.map(b => b.workflowId).filter((id): id is string => !!id)
  const workflowRows = workflowIds.length > 0
    ? await db
        .select({ id: workflows.id, name: workflows.name, ageBucket: workflows.ageBucket })
        .from(workflows)
        .where(inArray(workflows.id, workflowIds))
    : []
  const workflowMap = new Map(workflowRows.map(w => [w.id, w]))

  // Sort batches by bucket order (a → d)
  const sorted = [...batches].sort((a, b) => {
    const wA = a.workflowId ? (workflowMap.get(a.workflowId)?.ageBucket ?? 'z') : 'z'
    const wB = b.workflowId ? (workflowMap.get(b.workflowId)?.ageBucket ?? 'z') : 'z'
    return wA.localeCompare(wB)
  })

  const totalLeads = sorted.reduce((s, b) => s + b.leads.length, 0)

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">🎉</span>
          <h1 className="text-2xl font-bold text-gray-900">
            {sorted.length} pilot batch{sorted.length !== 1 ? 'es' : ''} created
          </h1>
        </div>
        <p className="text-sm text-gray-500">
          {totalLeads} lead{totalLeads !== 1 ? 's' : ''} across {sorted.length} age window{sorted.length !== 1 ? 's' : ''}.
          Each batch is in draft — no messages will be sent until you review and approve each one.
        </p>
      </div>

      {/* Batch list */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-900">Review each batch before approving</p>
          <p className="text-xs text-gray-500 mt-0.5">
            All batches are draft-only. Approving a batch does not send messages — that requires a separate live send step.
          </p>
        </div>

        {sorted.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">
            No batches found. They may have been created under a different tenant.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sorted.map((batch, idx) => {
              const wf     = batch.workflowId ? workflowMap.get(batch.workflowId) : null
              const bucket = wf?.ageBucket ?? null
              const label  = bucket ? (BUCKET_LABEL[bucket] ?? bucket) : 'No age bucket'

              return (
                <div key={batch.id} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Step number */}
                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {wf?.name ?? 'Unknown workflow'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {label} ·{' '}
                        <span className="font-medium text-gray-600">
                          {batch.leads.length} lead{batch.leads.length !== 1 ? 's' : ''}
                        </span>
                        <span className="ml-2 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-mono">
                          {batch.status}
                        </span>
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/admin/dlr/pilot-leads/batch/${batch.id}`}
                    className="flex-shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors"
                  >
                    Review →
                  </Link>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer summary */}
        {sorted.length > 0 && (
          <div className="bg-blue-50 border-t border-blue-100 px-5 py-3 flex items-center justify-between">
            <p className="text-xs text-blue-700">
              Review and approve each batch above. Start with batch 1 and work down.
            </p>
            <span className="text-xs font-semibold text-blue-700">
              {sorted.length} batch{sorted.length !== 1 ? 'es' : ''} pending review
            </span>
          </div>
        )}
      </div>

      {/* Nav */}
      <div className="text-xs text-gray-400 space-x-3">
        <Link href={`/admin/dlr/pilot-leads`} className="text-blue-600 underline">
          ← Back to Pilot Leads
        </Link>
        <Link href={`/admin/dlr/pilot`} className="text-blue-600 underline">
          All Pilot Batches
        </Link>
      </div>
    </div>
  )
}

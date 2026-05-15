/**
 * Phase 15 — Pilot Batch Review Page
 * /admin/dlr/pilot-leads/batch/[batchId]
 *
 * Read-only page (plus the approve action invoked from BatchChecklist).
 * Scoped to the caller's session tenant — admin role required.
 */

import { db } from '@/lib/db'
import { pilotBatches, pilotBatchLeads, leads, workflows, tenants } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import type { PilotPreviewMessage } from '@/lib/db/schema'
import { BatchChecklist } from './BatchChecklist'

type RouteContext = { params: { batchId: string } }

const CONSENT_STYLE: Record<string, string> = {
  explicit: 'text-emerald-700',
  implied:  'text-amber-700',
  unknown:  'text-gray-500',
  revoked:  'text-red-600 font-semibold',
}

export default async function PilotBatchReviewPage({ params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect('/login')
  if (session.user.role !== 'admin') redirect('/')

  const batch = await db.query.pilotBatches.findFirst({
    where: and(
      eq(pilotBatches.id, params.batchId),
      eq(pilotBatches.tenantId, session.user.tenantId),
    ),
  })
  if (!batch) notFound()

  const [tenant, workflow, batchLeadRows] = await Promise.all([
    db.query.tenants.findFirst({ where: eq(tenants.id, batch.tenantId) }),
    batch.workflowId
      ? db.query.workflows.findFirst({ where: eq(workflows.id, batch.workflowId) })
      : Promise.resolve(null),
    db.select().from(pilotBatchLeads).where(eq(pilotBatchLeads.batchId, params.batchId)),
  ])

  const leadIds = batchLeadRows.map(r => r.leadId)
  const leadRecords = leadIds.length > 0
    ? await db
        .select()
        .from(leads)
        .where(and(
          inArray(leads.id, leadIds),
          eq(leads.tenantId, session.user.tenantId),
        ))
    : []

  const leadMap = new Map(leadRecords.map(l => [l.id, l]))

  const consentCounts: Record<string, number> = {}
  for (const lead of leadRecords) {
    const c = lead.consentStatus ?? 'unknown'
    consentCounts[c] = (consentCounts[c] ?? 0) + 1
  }

  const isDraft    = batch.status === 'draft'
  const totalLeads = batchLeadRows.length

  let fallbackCount = 0
  for (const bl of batchLeadRows) {
    const previews = (bl.previewMessages as PilotPreviewMessage[] | null) ?? []
    if (previews.some(p => p.usedFallback)) fallbackCount++
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pilot Batch Review</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review this batch before approval. No SMS will be sent until live send approval is granted.
          </p>
        </div>
        <a
          href="/admin/dlr/pilot-leads"
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-600"
        >
          ← Back to Imports
        </a>
      </div>

      {/* Batch summary card */}
      <div className="bg-white border border-gray-200 rounded-xl px-6 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
            isDraft ? 'bg-gray-100 text-gray-600' :
            batch.status === 'approved' ? 'bg-blue-100 text-blue-700' :
            'bg-emerald-100 text-emerald-700'
          }`}>
            {batch.status}
          </span>
          {batch.isFirstPilot && (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
              First Pilot
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Tenant</p>
            <p className="font-semibold text-gray-800">{tenant?.name ?? batch.tenantId}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Workflow</p>
            <p className="font-semibold text-gray-800">{workflow?.name ?? batch.workflowId ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Leads</p>
            <p className="font-semibold text-gray-800">{totalLeads}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Created By</p>
            <p className="font-semibold text-gray-800">{batch.createdBy ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Batch ID</p>
            <p className="font-mono text-xs text-gray-500">{batch.id}</p>
          </div>
        </div>
      </div>

      {/* Consent summary */}
      <div className="border border-gray-200 rounded-xl px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Consent Summary</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(consentCounts).map(([status, count]) => (
            <span
              key={status}
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                status === 'explicit' ? 'bg-emerald-100 text-emerald-700' :
                status === 'implied'  ? 'bg-amber-100 text-amber-700' :
                status === 'revoked'  ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-600'
              }`}
            >
              {status}: {count}
            </span>
          ))}
          {fallbackCount > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
              fallback templates: {fallbackCount}
            </span>
          )}
        </div>
      </div>

      {/* Per-lead rows with message previews */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Lead Previews ({totalLeads})</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Review each lead&apos;s rendered messages before creating the batch.
          </p>
        </div>
        <div className="divide-y divide-gray-100">
          {batchLeadRows.map((bl, idx) => {
            const lead     = leadMap.get(bl.leadId)
            const previews = (bl.previewMessages as PilotPreviewMessage[] | null) ?? []

            return (
              <div key={bl.id} className="px-5 py-4 space-y-3">
                {/* Lead identity */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">
                      {idx + 1}. {lead?.firstName ?? '—'} {lead?.lastName ?? ''}
                    </p>
                    <p className="text-xs text-gray-500 font-mono">{lead?.phone ?? '—'}</p>
                    {lead?.vehicleOfInterest && (
                      <p className="text-xs text-gray-500">{lead.vehicleOfInterest}</p>
                    )}
                  </div>
                  <div className="text-right text-xs">
                    <span className={`font-medium ${CONSENT_STYLE[lead?.consentStatus ?? 'unknown'] ?? 'text-gray-500'}`}>
                      {lead?.consentStatus ?? 'unknown'}
                    </span>
                    {bl.approvedForSend && (
                      <p className="text-emerald-600 font-semibold mt-0.5">✓ Approved for send</p>
                    )}
                  </div>
                </div>

                {/* Message previews */}
                {previews.length > 0 ? (
                  <div className="space-y-2 pl-4 border-l-2 border-gray-200">
                    {previews.map((p, i) => (
                      <div key={i} className="text-xs">
                        <p className="text-gray-400 mb-1">
                          Step {p.position}
                          {p.delayHours ? ` (after ${p.delayHours}h)` : ' (immediate)'}
                          {p.usedFallback && <span className="ml-1 text-amber-600 font-semibold">⚠ fallback template</span>}
                        </p>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 leading-relaxed whitespace-pre-wrap">
                          {p.rendered}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic pl-4">No message previews available for this lead.</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Pre-approval checklist — gated: all boxes must be checked to proceed */}
      {isDraft && (
        <BatchChecklist
          batchId={params.batchId}
          totalLeads={totalLeads}
          maxLeads={batch.maxLeadCount ?? 5}
        />
      )}

      {/* Nav */}
      <div className="text-xs text-gray-400 space-x-3">
        <a href="/admin/dlr/pilot-leads" className="text-blue-600 underline">← Pilot Leads</a>
        <a href="/admin/dlr/pilot" className="text-blue-600 underline">All Pilot Batches</a>
        <a href="/admin/dlr/live-pilot" className="text-blue-600 underline">Live Pilot</a>
      </div>
    </div>
  )
}

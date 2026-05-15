/**
 * /dealer/batches/[batchId]
 *
 * Dealer-facing batch review page. Mirrors the admin batch review page but:
 *  - Scoped to session.user.tenantId (no cross-tenant access)
 *  - Uses DealerBatchChecklist with an approve server action
 *  - Language is dealer-centric ("your batch", not "this tenant")
 *  - Back link goes to /dealer/batches
 */

import { db } from '@/lib/db'
import { pilotBatches, pilotBatchLeads, leads, workflows } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import type { PilotPreviewMessage } from '@/lib/db/schema'
import { DealerBatchChecklist } from './DealerBatchChecklist'

type RouteContext = { params: { batchId: string } }

const CONSENT_STYLE: Record<string, string> = {
  explicit: 'text-emerald-700',
  implied:  'text-amber-700',
  unknown:  'text-gray-500',
  revoked:  'text-red-600 font-semibold',
}

export default async function DealerBatchReviewPage({ params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId = session.user.tenantId

  // Load batch — scoped to dealer's tenantId for security
  const batch = await db.query.pilotBatches.findFirst({
    where: and(
      eq(pilotBatches.id, params.batchId),
      eq(pilotBatches.tenantId, tenantId),
    ),
  })
  if (!batch) notFound()

  const [workflow, batchLeadRows] = await Promise.all([
    db.query.workflows.findFirst({ where: eq(workflows.id, batch.workflowId ?? '') }),
    db
      .select()
      .from(pilotBatchLeads)
      .where(eq(pilotBatchLeads.batchId, params.batchId)),
  ])

  // Load lead records
  const leadIds = batchLeadRows.map(r => r.leadId)
  const leadRecords = leadIds.length > 0
    ? await Promise.all(
        leadIds.map(id => db.query.leads.findFirst({ where: eq(leads.id, id) }))
      ).then(all => all.filter((l): l is NonNullable<typeof l> => !!l))
    : []

  const leadMap = new Map(leadRecords.map(l => [l.id, l]))

  // Consent summary
  const consentCounts: Record<string, number> = {}
  for (const lead of leadRecords) {
    const c = lead.consentStatus ?? 'unknown'
    consentCounts[c] = (consentCounts[c] ?? 0) + 1
  }

  const isDraft    = batch.status === 'draft'
  const isApproved = batch.status === 'approved'
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
          <h1 className="text-2xl font-bold text-gray-900">Batch Review</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review each lead&apos;s messages before approving. Nothing is sent until you approve
            and we complete live-send activation together.
          </p>
        </div>
        <a
          href="/dealer/batches"
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-600"
        >
          ← All Batches
        </a>
      </div>

      {/* Already approved banner */}
      {isApproved && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm font-semibold text-emerald-900">
            ✓ You approved this batch
            {batch.approvedAt ? ` on ${new Date(batch.approvedAt).toLocaleDateString()}` : ''}.
          </p>
          <p className="text-xs text-emerald-700 mt-0.5">
            Our team will complete 10DLC verification before any messages are sent. We&apos;ll be in touch.
          </p>
        </div>
      )}

      {/* Batch summary */}
      <div className="bg-white border border-gray-200 rounded-xl px-6 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
            isDraft    ? 'bg-gray-100 text-gray-600'    :
            isApproved ? 'bg-blue-100 text-blue-700'    :
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
            <p className="text-xs text-gray-500 uppercase tracking-wide">Workflow</p>
            <p className="font-semibold text-gray-800">{workflow?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Leads</p>
            <p className="font-semibold text-gray-800">{totalLeads}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Created</p>
            <p className="font-semibold text-gray-800">
              {new Date(batch.createdAt).toLocaleDateString()}
            </p>
          </div>
          {batch.approvedAt && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Approved</p>
              <p className="font-semibold text-gray-800">
                {new Date(batch.approvedAt).toLocaleDateString()}
                {batch.approvedBy ? ` by ${batch.approvedBy}` : ''}
              </p>
            </div>
          )}
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
        <p className="text-xs text-gray-500 mt-2">
          Fallback templates are used when a lead&apos;s vehicle of interest isn&apos;t on file —
          they&apos;re still personalised to first name and dealership.
        </p>
      </div>

      {/* Per-lead message previews */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">
            Message Previews ({totalLeads} leads)
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            These are the exact messages each lead will receive, in order.
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
                          Message {i + 1}
                          {p.delayHours
                            ? ` — sent ${p.delayHours >= 24
                                ? `${Math.round(p.delayHours / 24)} day${Math.round(p.delayHours / 24) !== 1 ? 's' : ''}`
                                : `${p.delayHours}h`} after previous`
                            : ' — immediate'
                          }
                          {p.usedFallback && (
                            <span className="ml-1 text-amber-600 font-semibold">⚠ no vehicle on file</span>
                          )}
                        </p>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 leading-relaxed whitespace-pre-wrap">
                          {p.rendered}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic pl-4">
                    No message previews available for this lead.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Dealer checklist + approve action */}
      {isDraft && (
        <DealerBatchChecklist
          batchId={params.batchId}
          totalLeads={totalLeads}
          maxLeads={batch.maxLeadCount ?? 10}
        />
      )}

      {/* Footer nav */}
      <div className="text-xs text-gray-400 space-x-3">
        <a href="/dealer/batches" className="text-blue-600 underline">← All Batches</a>
        <a href="/dealer/dashboard" className="text-blue-600 underline">Dashboard</a>
        <a href="/dealer/inbox" className="text-blue-600 underline">Inbox</a>
      </div>
    </div>
  )
}

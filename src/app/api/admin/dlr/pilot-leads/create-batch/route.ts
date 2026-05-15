/**
 * POST /api/admin/dlr/pilot-leads/create-batch
 *
 * Create draft pilot batches from selected import rows for the caller's tenant.
 *
 * Body: {
 *   importIds:   string[]   — pilot_lead_imports.id values to include
 *   workflowId?: string     — legacy: single workflow for all leads
 * }
 *
 * Response: {
 *   ok:      true
 *   batches: Array<{ batchId, workflowId, workflowName, ageBucket, leadCount }>
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/requireAuth'
import {
  createBucketsFromImport,
  createPilotBatchFromImport,
} from '@/lib/pilot/lead-import'
import { runBatchPreview } from '@/lib/pilot/preview'

type PreviewWarning = { batchId: string; error: string }

/**
 * Invoke runBatchPreview for each just-created batch in parallel. Each call
 * is independently try/caught so one batch's preview failure can't poison
 * the others. Batch rows are already committed by the time this runs, so a
 * failure here cannot corrupt batch state — the worst case is that the
 * admin sees a freshly-created batch with no previews and uses the manual
 * "Run Dry-Run Preview" button on /admin/dlr/pilot/[id] to retry.
 */
async function previewAll(batchIds: string[]): Promise<PreviewWarning[]> {
  const results = await Promise.all(
    batchIds.map(async (batchId) => {
      try {
        await runBatchPreview(batchId)
        return null
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[pilot-leads/create-batch] preview failed for batch ${batchId}:`, err)
        return { batchId, error: msg } satisfies PreviewWarning
      }
    }),
  )
  return results.filter((r): r is PreviewWarning => r !== null)
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin()
  if (error) return error
  const tenantId  = session.user.tenantId
  const createdBy = session.user.email ?? 'admin'

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const { workflowId, importIds } = body as {
      workflowId?: string
      importIds?:  string[]
    }

    if (!Array.isArray(importIds) || importIds.length === 0) {
      return NextResponse.json(
        { error: 'importIds[] is required' },
        { status: 400 },
      )
    }

    if (!workflowId) {
      const batches = await createBucketsFromImport(tenantId, importIds, createdBy)
      const previewWarnings = await previewAll(batches.map(b => b.batchId))

      return NextResponse.json({
        ok:      true,
        batches,
        message: `${batches.length} draft batch${batches.length === 1 ? '' : 'es'} created ` +
                 `(${batches.reduce((s, b) => s + b.leadCount, 0)} leads). ` +
                 'Batches are in draft mode — no sends will occur until each is approved.',
        ...(previewWarnings.length > 0 ? { previewWarnings } : {}),
      })
    }

    const batchId = await createPilotBatchFromImport({
      tenantId,
      workflowId,
      createdBy,
      importIds,
    })
    const previewWarnings = await previewAll([batchId])

    return NextResponse.json({
      ok:      true,
      batches: [{ batchId, workflowId, workflowName: null, ageBucket: null, leadCount: importIds.length }],
      batchId,
      message: `Draft pilot batch created (${importIds.length} leads). ` +
               'Batch is in draft mode — no sends will occur until it is approved.',
      ...(previewWarnings.length > 0 ? { previewWarnings } : {}),
    })
  } catch (err) {
    console.error('[pilot-leads/create-batch]', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 422 })
  }
}

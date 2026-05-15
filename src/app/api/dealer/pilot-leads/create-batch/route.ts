/**
 * POST /api/dealer/pilot-leads/create-batch
 *
 * Dealer-side mirror of the admin create-batch endpoint. Mirrors the same
 * auto-preview-on-create behaviour (6188a5a) — every batch produced is
 * previewed before the response returns.
 *
 * Body: { importIds: string[], workflowId?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDealer } from '@/lib/api/requireAuth'
import {
  createBucketsFromImport,
  createPilotBatchFromImport,
} from '@/lib/pilot/lead-import'
import { runBatchPreview } from '@/lib/pilot/preview'

type PreviewWarning = { batchId: string; error: string }

async function previewAll(batchIds: string[]): Promise<PreviewWarning[]> {
  const results = await Promise.all(
    batchIds.map(async (batchId) => {
      try {
        await runBatchPreview(batchId)
        return null
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[dealer/pilot-leads/create-batch] preview failed for batch ${batchId}:`, err)
        return { batchId, error: msg } satisfies PreviewWarning
      }
    }),
  )
  return results.filter((r): r is PreviewWarning => r !== null)
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireDealer()
  if (error) return error
  const tenantId  = session.user.tenantId
  const createdBy = session.user.email ?? 'dealer'

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
    console.error('[dealer/pilot-leads/create-batch]', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 422 })
  }
}

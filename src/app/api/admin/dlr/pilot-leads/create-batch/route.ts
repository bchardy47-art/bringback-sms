/**
 * POST /api/admin/dlr/pilot-leads/create-batch
 *
 * Create a draft pilot batch from selected import rows.
 *
 * Body: {
 *   tenantId:   string
 *   workflowId: string
 *   importIds:  string[]   — pilot_lead_imports.id values to include
 * }
 *
 * Safety guarantees:
 *   - Batch is created with status='draft' — no sends will occur
 *   - isFirstPilot=true — batch is subject to the Phase 13 confirmation gate
 *   - No enrollments are created
 *   - No Telnyx API calls are made
 *   - Blocked leads are automatically excluded
 *   - Hard cap of FIRST_PILOT_CAP (5) leads enforced
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createPilotBatchFromImport } from '@/lib/pilot/lead-import'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const createdBy = (session.user as { email?: string })?.email ?? 'admin'

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const { tenantId, workflowId, importIds } = body as {
      tenantId?: string
      workflowId?: string
      importIds?: string[]
    }

    if (!tenantId || !workflowId || !Array.isArray(importIds) || importIds.length === 0) {
      return NextResponse.json(
        { error: 'tenantId, workflowId, and importIds[] are required' },
        { status: 400 },
      )
    }

    const batchId = await createPilotBatchFromImport({
      tenantId,
      workflowId,
      createdBy,
      importIds,
    })

    return NextResponse.json({
      ok:      true,
      batchId,
      message: `Draft pilot batch created (${importIds.length} leads). ` +
               'Batch is in draft mode — no sends will occur until it is approved and the ' +
               'Phase 13 confirmation gate is passed.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 422 })
  }
}

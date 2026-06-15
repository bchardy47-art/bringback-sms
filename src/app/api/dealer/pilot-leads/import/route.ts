/**
 * POST /api/dealer/pilot-leads/import
 *
 * Dealer-side mirror of /api/admin/dlr/pilot-leads/import. Same import
 * pipeline (importLeads / importLeadsFromCSV from src/lib/pilot/lead-import),
 * gated to role='dealer' so admins continue to use the /admin/dlr route.
 *
 * tenantId comes from the session — dealers can only import into their own
 * tenant.
 *
 * Compliance (C-2):
 *   - Body MUST include `attested === true`. Reject 400 otherwise — the UI
 *     gate is duplicated here so a forged client request can't bypass it.
 *   - Before importing, a compliance_attestations row is written under a
 *     synthetic uploadId. The import only proceeds if the attestation
 *     write succeeds (strict-write policy). If the import later fails
 *     mechanically, the attestation row stays as evidence of intent.
 *   - resourceId = uploadId (UUID) since pilot_lead_imports doesn't carry
 *     a per-upload grouping column today. The uploadId is returned in the
 *     response for any caller that wants to correlate later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireDealer } from '@/lib/api/requireAuth'
import {
  importLeads,
  importLeadsFromCSV,
  type LeadImportInput,
} from '@/lib/pilot/lead-import'
import { recordAttestation, extractClientContext } from '@/lib/compliance/attestation'
import {
  LEAD_UPLOAD_CERT_TEXT,
  LEAD_UPLOAD_CERT_VERSION,
} from '@/lib/compliance/attestation-text'

// Rough best-effort row count from a raw CSV string — used to populate
// the attestation's lead_count column. The actual imported count is
// returned in the response (and can differ if rows fail validation).
function countCsvRows(csv: string): number {
  const trimmed = csv.replace(/\r/g, '').trim()
  if (!trimmed) return 0
  const lines = trimmed.split('\n').filter(l => l.trim().length > 0)
  // Assume the first line is a header (matches how importLeadsFromCSV parses).
  return Math.max(0, lines.length - 1)
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireDealer()
  if (error) return error
  const tenantId   = session.user.tenantId
  const userId     = session.user.id
  const importedBy = session.user.email ?? 'dealer'

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    // ── C-2: attestation gate ────────────────────────────────────────────
    // Server-side enforcement of the UI checkbox. UI also gates this, but
    // never trust the client.
    if (body.attested !== true) {
      return NextResponse.json(
        { error: 'Compliance attestation is required before upload.' },
        { status: 400 },
      )
    }

    // Determine the payload shape + best-effort lead count for the audit row
    let csvString: string | null = null
    let rowsArray: LeadImportInput[] | null = null
    let intendedLeadCount = 0
    if (typeof body.csv === 'string') {
      csvString = body.csv
      intendedLeadCount = countCsvRows(csvString)
    } else if (Array.isArray(body.rows)) {
      rowsArray = body.rows as LeadImportInput[]
      intendedLeadCount = rowsArray.length
    } else {
      return NextResponse.json(
        { error: 'Provide either "csv" (string) or "rows" (array) in the request body' },
        { status: 400 },
      )
    }

    const fileName = typeof body.fileName === 'string' ? body.fileName : null

    // ── C-2: write attestation FIRST (strict policy) ─────────────────────
    // Synthetic uploadId — pilot_lead_imports has no per-upload column, so
    // we mint a UUID at request time, persist it on the attestation, and
    // return it in the response for downstream correlation.
    const uploadId = randomUUID()
    const { ipAddress, userAgent } = extractClientContext(req.headers)

    let attestationId: string
    try {
      attestationId = await recordAttestation({
        tenantId,
        userId,
        type:            'lead_upload_certification',
        resourceType:    'lead_import',
        resourceId:      uploadId,
        textVersion:     LEAD_UPLOAD_CERT_VERSION,
        attestationText: LEAD_UPLOAD_CERT_TEXT,
        fileName,
        leadCount:       intendedLeadCount,
        ipAddress,
        userAgent,
        metadata:        { mode: csvString ? 'csv' : 'rows' },
      })
    } catch (attErr) {
      console.error('[dealer/pilot-leads/import] attestation write failed:', attErr)
      // Strict-write: no audit row → no upload.
      return NextResponse.json(
        { error: 'Could not record compliance attestation — upload aborted.' },
        { status: 500 },
      )
    }

    // ── Import (only runs if attestation succeeded) ──────────────────────
    const runResult = csvString !== null
      ? await importLeadsFromCSV(csvString, tenantId, importedBy)
      : await importLeads(rowsArray!, tenantId, importedBy)

    const inserted = runResult.inserted
    const summary  = runResult.summary

    return NextResponse.json({
      ok:      true,
      uploadId,
      attestationId,
      // Back-compat fields — `count` is still the count of NEW rows the dealer
      // sees on /dealer/import after this upload. The richer breakdown lives
      // on `summary`.
      count:   inserted.length,
      eligible: summary.eligible,
      warned:   summary.warning,
      blocked:  summary.blocked,
      // New: dealer-facing summary including cross-session dedupe.
      summary,
      results: inserted.map(r => ({
        id:             r.id,
        firstName:      r.firstName,
        lastName:       r.lastName,
        phone:          r.phone,
        phoneRaw:       r.phoneRaw,
        importStatus:   r.importStatus,
        blockedReasons: r.blockedReasons ?? [],
        warnings:       r.warnings ?? [],
        duplicateOfLeadId:   r.duplicateOfLeadId,
        duplicateOfImportId: r.duplicateOfImportId,
      })),
    })
  } catch (err) {
    console.error('[dealer/pilot-leads/import]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

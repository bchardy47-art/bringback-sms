/**
 * Phase 15 — Pilot Prep UX + Dry-Run Review
 *
 * Review utilities for pilot lead imports:
 *   - Edit imported lead fields + re-validate
 *   - Mark lead as reviewed (human sign-off)
 *   - Bulk-clear blocked imports (exclude)
 *   - Generate dry-run report (recommendation: ready / fix_warnings / blocked)
 *
 * SAFETY INVARIANTS (inherited from Phase 14):
 *   - No enrollments created
 *   - No Telnyx / SMS calls made
 *   - Batch status stays 'draft' until Phase 13 confirmation gate
 */

import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  pilotLeadImports,
  tenants,
  type PilotImportDryRunReport,
} from '@/lib/db/schema'
import {
  validateImportRow,
  type LeadImportInput,
} from '@/lib/pilot/lead-import'

// ── Types ──────────────────────────────────────────────────────────────────────

export type UpdateImportedLeadInput = Partial<
  Pick<
    LeadImportInput,
    | 'firstName'
    | 'lastName'
    | 'phone'
    | 'email'
    | 'vehicleName'
    | 'leadSource'
    | 'originalInquiryAt'
    | 'consentStatus'
    | 'consentSource'
    | 'consentCapturedAt'
    | 'notes'
    | 'smsConsentNotes'
  >
>

export type UpdateImportedLeadResult = {
  ok:           boolean
  error?:       string
  importStatus? : string
  blockedReasons?: string[]
  warnings?:    string[]
}

// ── Edit + Re-validate ─────────────────────────────────────────────────────────

/**
 * Update editable fields on a pilot lead import row and re-run full validation.
 * The import row is never promoted to a lead here — it stays in pilot_lead_imports.
 *
 * If the lead was previously selected-for-batch and the re-validation makes it
 * blocked, selection is automatically cleared.
 */
export async function updateImportedLead(
  importId: string,
  updates: UpdateImportedLeadInput,
  tenantId: string,
): Promise<UpdateImportedLeadResult> {
  // Load current row
  const row = await db.query.pilotLeadImports.findFirst({
    where: and(
      eq(pilotLeadImports.id, importId),
      eq(pilotLeadImports.tenantId, tenantId),
    ),
  })
  if (!row) return { ok: false, error: 'Import row not found' }
  if (row.importStatus === 'excluded') {
    return { ok: false, error: 'Cannot edit an excluded import row' }
  }

  // Merge updates onto current row values to form the re-validation input
  const merged: LeadImportInput = {
    firstName:         updates.firstName         ?? row.firstName,
    lastName:          updates.lastName          ?? row.lastName,
    phone:             updates.phone             ?? row.phoneRaw,
    email:             updates.email             ?? row.email,
    vehicleName:       updates.vehicleName       ?? row.vehicleOfInterest,
    leadSource:        updates.leadSource        ?? row.leadSource,
    originalInquiryAt: updates.originalInquiryAt ?? null,
    consentStatus:     updates.consentStatus     ?? row.consentStatus,
    consentSource:     updates.consentSource     ?? row.consentSource,
    consentCapturedAt: updates.consentCapturedAt ?? null,
    notes:             updates.notes             ?? row.notes,
    smsConsentNotes:   updates.smsConsentNotes   ?? row.smsConsentNotes,
  }

  // Re-validate — pass empty dedup maps since we're editing an existing row
  // (intra-session dups were caught on original import)
  const validation = await validateImportRow(merged, tenantId, new Map(), new Map())

  // If re-validation makes the lead blocked, deselect it
  const wasSelected = row.selectedForBatch
  const nowBlocked  = validation.importStatus === 'blocked'
  const newSelected = wasSelected && !nowBlocked

  const now = new Date()
  await db
    .update(pilotLeadImports)
    .set({
      firstName:           merged.firstName.trim(),
      lastName:            merged.lastName.trim(),
      phoneRaw:            merged.phone,
      phone:               validation.phone,
      email:               merged.email?.trim().toLowerCase() || null,
      vehicleOfInterest:   merged.vehicleName?.trim() || null,
      leadSource:          merged.leadSource?.trim() || null,
      consentStatus:       merged.consentStatus?.trim() || 'unknown',
      consentSource:       merged.consentSource?.trim() || null,
      notes:               merged.notes?.trim() || null,
      smsConsentNotes:     merged.smsConsentNotes?.trim() || null,
      importStatus:        newSelected ? 'selected' : validation.importStatus,
      blockedReasons:      validation.blockedReasons.length > 0 ? validation.blockedReasons : null,
      warnings:            validation.warnings.length > 0 ? validation.warnings : null,
      selectedForBatch:    newSelected,
      // Clear stale previews — user must re-render after editing
      previewMessages:     null,
      updatedAt:           now,
    })
    .where(eq(pilotLeadImports.id, importId))

  return {
    ok:             true,
    importStatus:   newSelected ? 'selected' : validation.importStatus,
    blockedReasons: validation.blockedReasons,
    warnings:       validation.warnings,
  }
}

// ── Mark as Reviewed ───────────────────────────────────────────────────────────

/**
 * Mark a pilot lead import row as reviewed.
 * Idempotent — safe to call multiple times.
 */
export async function markReviewed(
  importId: string,
  reviewedBy: string,
  tenantId: string,
): Promise<{ ok: boolean; error?: string }> {
  const row = await db.query.pilotLeadImports.findFirst({
    where: and(
      eq(pilotLeadImports.id, importId),
      eq(pilotLeadImports.tenantId, tenantId),
    ),
  })
  if (!row) return { ok: false, error: 'Import row not found' }

  await db
    .update(pilotLeadImports)
    .set({
      reviewed:    true,
      reviewedAt:  new Date(),
      reviewedBy,
      updatedAt:   new Date(),
    })
    .where(eq(pilotLeadImports.id, importId))

  return { ok: true }
}

// ── Bulk Clear Blocked ─────────────────────────────────────────────────────────

/**
 * Exclude all blocked import rows for a tenant (soft delete).
 * Selected rows are never blocked (invariant from setLeadSelected),
 * so this is safe to call without touching selected leads.
 *
 * Returns the number of rows excluded.
 */
export async function bulkClearBlocked(
  tenantId: string,
): Promise<number> {
  const blockedRows = await db
    .select({ id: pilotLeadImports.id })
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      eq(pilotLeadImports.importStatus, 'blocked'),
    ))

  if (blockedRows.length === 0) return 0

  const ids = blockedRows.map(r => r.id)
  await db
    .update(pilotLeadImports)
    .set({ importStatus: 'excluded', selectedForBatch: false, updatedAt: new Date() })
    .where(inArray(pilotLeadImports.id, ids))

  return ids.length
}

// ── Dry-Run Report ─────────────────────────────────────────────────────────────

/**
 * Generate a dry-run report for a tenant's current pilot lead import set.
 *
 * Aggregates all non-excluded import rows and produces:
 *   - Counts by status
 *   - Consent coverage breakdown
 *   - Duplicate / fallback tallies
 *   - Per-lead detail rows (first message preview)
 *   - Recommendation: 'ready' | 'fix_warnings' | 'blocked'
 */
export async function generateDryRunReport(
  tenantId: string,
): Promise<PilotImportDryRunReport> {
  // Load tenant name for the report
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  })

  // Load all non-excluded import rows
  const rows = await db
    .select()
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      ne(pilotLeadImports.importStatus, 'excluded'),
    ))

  // ── Aggregate counts ──────────────────────────────────────────────────────────
  let selectedCount  = 0
  let eligibleCount  = 0
  let warningCount   = 0
  let blockedCount   = 0
  let reviewedCount  = 0
  let duplicateCount = 0
  let fallbackCount  = 0
  const consentCoverage: Record<string, number> = {}

  // Per-lead detail rows
  const leadRows: PilotImportDryRunReport['leads'] = []

  for (const row of rows) {
    // Counts
    if (row.importStatus === 'selected')  selectedCount++
    if (row.importStatus === 'eligible')  eligibleCount++
    if (row.importStatus === 'warning')   warningCount++
    if (row.importStatus === 'blocked')   blockedCount++
    if (row.reviewed)                     reviewedCount++
    if (row.duplicateOfLeadId || row.duplicateOfImportId) duplicateCount++

    // Consent coverage
    const consent = row.consentStatus ?? 'unknown'
    consentCoverage[consent] = (consentCoverage[consent] ?? 0) + 1

    // Fallback detection: any preview message that used a fallback template
    const previews = (row.previewMessages as Array<{ usedFallback?: boolean }> | null) ?? []
    const hasFallback = previews.some(p => p.usedFallback)
    if (hasFallback) fallbackCount++

    // First message body for the report
    const firstPreview = previews[0]
    const firstMessage = firstPreview
      ? (firstPreview as { rendered?: string }).rendered ?? null
      : null

    leadRows.push({
      importId:       row.id,
      firstName:      row.firstName,
      lastName:       row.lastName,
      phone:          row.phone,
      consentStatus:  row.consentStatus ?? 'unknown',
      importStatus:   row.importStatus,
      selected:       row.selectedForBatch,
      reviewed:       row.reviewed,
      isDuplicate:    !!(row.duplicateOfLeadId || row.duplicateOfImportId),
      hasFallback,
      blockedReasons: (row.blockedReasons as string[] | null) ?? [],
      warnings:       (row.warnings as string[] | null) ?? [],
      firstMessage,
    })
  }

  // ── Recommendation ────────────────────────────────────────────────────────────
  let recommendation: PilotImportDryRunReport['recommendation']
  let recommendationReason: string

  if (blockedCount > 0) {
    recommendation       = 'blocked'
    recommendationReason = `${blockedCount} lead${blockedCount === 1 ? '' : 's'} ${blockedCount === 1 ? 'is' : 'are'} blocked and must be resolved or excluded before creating a batch.`
  } else if (warningCount > 0) {
    recommendation       = 'fix_warnings'
    recommendationReason = `${warningCount} lead${warningCount === 1 ? '' : 's'} ${warningCount === 1 ? 'has' : 'have'} warnings. Review and confirm before creating a batch.`
  } else if (selectedCount === 0) {
    recommendation       = 'fix_warnings'
    recommendationReason = 'No leads are selected for the batch. Select 1–5 eligible leads to proceed.'
  } else {
    recommendation       = 'ready'
    recommendationReason = `${selectedCount} lead${selectedCount === 1 ? '' : 's'} selected, no blockers, no warnings. Ready to create pilot batch.`
  }

  return {
    generatedAt:         new Date().toISOString(),
    tenantId,
    totalImported:       rows.length,
    selectedCount,
    eligibleCount,
    warningCount,
    blockedCount,
    reviewedCount,
    consentCoverage,
    duplicateCount,
    fallbackCount,
    leads:               leadRows,
    recommendation,
    recommendationReason,
  }
}

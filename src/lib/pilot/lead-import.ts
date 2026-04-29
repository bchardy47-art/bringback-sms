/**
 * Phase 14 — Pilot Lead Import + Selection
 *
 * Handles CSV and manual import of pilot lead candidates:
 *   1. Normalize phone numbers to E.164
 *   2. Deduplicate within the import session and against existing leads
 *   3. Check opt-out table
 *   4. Validate consent status
 *   5. Enforce doNotAutomate / isTest blocks
 *   6. Render message previews per selected workflow
 *   7. Create a draft pilot batch from selected eligible leads
 *
 * SAFETY INVARIANTS:
 *   - No enrollments are created at any point
 *   - No Telnyx API calls are made
 *   - Batch is created with status='draft' and isFirstPilot=true
 *   - Batch will not send until Phase 13 confirmation gate is passed
 */

import { and, eq, inArray, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  leads, optOuts, pilotBatches, pilotBatchLeads, pilotLeadImports,
  workflows, workflowSteps, tenants,
  FIRST_PILOT_CAP,
  type PilotLeadImportStatus,
  type PilotEligibilityResult,
  type PilotPreviewMessage,
} from '@/lib/db/schema'
import { previewWorkflow } from '@/lib/workflows/preview'
import type { SendSmsConfig } from '@/lib/db/schema'

// ── Types ──────────────────────────────────────────────────────────────────────

export type LeadImportInput = {
  firstName:         string
  lastName:          string
  phone:             string
  email?:            string | null
  vehicleName?:      string | null  // maps to vehicleOfInterest
  leadSource?:       string | null
  originalInquiryAt?: string | null // ISO string or parseable date string
  consentStatus?:    string | null  // explicit | implied | unknown | revoked
  consentSource?:    string | null
  consentCapturedAt?: string | null
  notes?:            string | null
  crmSource?:        string | null
  externalId?:       string | null
  smsConsentNotes?:  string | null
}

export type ImportValidationResult = {
  phone:          string | null          // normalized E.164
  importStatus:   PilotLeadImportStatus
  blockedReasons: string[]
  warnings:       string[]
  duplicateOfLeadId:   string | null
  duplicateOfImportId: string | null
}

export type CreateBatchParams = {
  tenantId:    string
  workflowId:  string
  createdBy:   string
  importIds:   string[]   // pilot_lead_imports.id — must already be selected + eligible/warning
}

// ── Phone normalization ────────────────────────────────────────────────────────

/**
 * Normalize a raw phone string to E.164 format (+1XXXXXXXXXX for US numbers).
 * Returns null if the number cannot be reliably normalized.
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return null
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

// ── CSV parser ─────────────────────────────────────────────────────────────────

/**
 * Parse a CSV string into an array of raw field maps.
 * Handles double-quoted fields (including fields with embedded commas/newlines).
 * Returns [] if the CSV has fewer than 2 lines (header + at least one row).
 */
export function parseCSV(csv: string): Record<string, string>[] {
  const rows = splitCSVRows(csv)
  if (rows.length < 2) return []

  const headers = parseCSVLine(rows[0]).map(h => h.trim())
  const result: Record<string, string>[] = []

  for (let i = 1; i < rows.length; i++) {
    const line = rows[i].trim()
    if (!line) continue
    const values = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? '').trim()
    })
    result.push(row)
  }

  return result
}

function splitCSVRows(csv: string): string[] {
  const rows: string[] = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    if (ch === '"') {
      if (inQuote && csv[i + 1] === '"') {
        // Escaped quote — keep both characters for parseCSVLine to handle
        current += '""'
        i++
      } else {
        inQuote = !inQuote
        current += '"'   // Preserve the quote so parseCSVLine can detect field boundaries
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (ch === '\r' && csv[i + 1] === '\n') i++
      rows.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) rows.push(current)
  return rows
}

function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuote = !inQuote
      }
    } else if (ch === ',' && !inQuote) {
      values.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  values.push(current)
  return values
}

/**
 * Map a raw CSV row to a LeadImportInput.
 * Accepts both camelCase and snake_case header names.
 */
export function csvRowToImportInput(row: Record<string, string>): LeadImportInput {
  const get = (...keys: string[]): string | undefined =>
    keys.map(k => row[k]).find(v => v !== undefined && v !== '')

  return {
    firstName:         get('firstName', 'first_name', 'First Name', 'firstname') ?? '',
    lastName:          get('lastName', 'last_name', 'Last Name', 'lastname') ?? '',
    phone:             get('phone', 'Phone', 'mobile', 'Mobile', 'cell') ?? '',
    email:             get('email', 'Email') ?? null,
    vehicleName:       get('vehicleName', 'vehicle_name', 'vehicleInterest', 'vehicle_of_interest', 'Vehicle') ?? null,
    leadSource:        get('leadSource', 'lead_source', 'source', 'Source') ?? null,
    originalInquiryAt: get('originalInquiryAt', 'original_inquiry_at', 'inquiryDate', 'inquiry_date') ?? null,
    consentStatus:     get('consentStatus', 'consent_status', 'consent') ?? null,
    consentSource:     get('consentSource', 'consent_source') ?? null,
    consentCapturedAt: get('consentCapturedAt', 'consent_captured_at') ?? null,
    notes:             get('notes', 'Notes') ?? null,
    crmSource:         get('crmSource', 'crm_source') ?? null,
    externalId:        get('externalId', 'external_id', 'id', 'ID') ?? null,
    smsConsentNotes:   get('smsConsentNotes', 'sms_consent_notes') ?? null,
  }
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validate a single import row against the DB.
 *
 * @param input            — raw input fields
 * @param tenantId         — tenant UUID
 * @param seenPhones       — normalized phones already seen in this import session
 * @param seenEmails       — emails already seen in this import session
 * @param seenImportIds    — map from normalized phone → import row id already saved
 */
export async function validateImportRow(
  input: LeadImportInput,
  tenantId: string,
  seenPhones: Map<string, string>,   // normalizedPhone → importId
  seenEmails: Map<string, string>,   // email → importId
): Promise<ImportValidationResult> {
  const blocked: string[] = []
  const warnings: string[] = []
  let duplicateOfLeadId: string | null = null
  let duplicateOfImportId: string | null = null

  // 1. Phone normalization
  const phone = normalizePhone(input.phone)
  if (!phone) {
    blocked.push(`Invalid phone number: "${input.phone}" — cannot be normalized to E.164`)
  }

  // 2. Intra-session dedup (by phone)
  if (phone && seenPhones.has(phone)) {
    duplicateOfImportId = seenPhones.get(phone) ?? null
    blocked.push(`Duplicate phone in this import session (${phone})`)
  }

  // 3. Intra-session dedup (by email)
  const email = input.email?.trim().toLowerCase() || null
  if (email && seenEmails.has(email)) {
    if (!duplicateOfImportId) duplicateOfImportId = seenEmails.get(email) ?? null
    warnings.push(`Duplicate email in this import session (${email})`)
  }

  // DB checks — only if phone is valid and not already a session dup
  if (phone && !seenPhones.has(phone)) {
    // 4. Check existing opted-out numbers
    const optOutRows = await db
      .select()
      .from(optOuts)
      .where(and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, phone)))
      .limit(1)
    if (optOutRows.length > 0) {
      blocked.push(`Phone ${phone} has opted out of SMS — cannot be included`)
    }

    // 5. Check existing leads for dedup + isTest / doNotAutomate
    const existingLeadRows = await db
      .select()
      .from(leads)
      .where(and(
        eq(leads.tenantId, tenantId),
        email
          ? or(eq(leads.phone, phone), eq(leads.email, email))
          : eq(leads.phone, phone),
      ))
      .limit(1)

    if (existingLeadRows.length > 0) {
      const existing = existingLeadRows[0]
      duplicateOfLeadId = existing.id
      warnings.push(`Lead already exists in your database (ID: ${existing.id.slice(0, 8)}…)`)

      if (existing.isTest) {
        blocked.push('Existing lead is marked as a test lead (isTest=true) — cannot pilot')
      }
      if (existing.doNotAutomate) {
        blocked.push('Existing lead has doNotAutomate=true — cannot include in pilot')
      }
      if (existing.state === 'opted_out') {
        blocked.push('Existing lead state is opted_out — cannot include in pilot')
      }
    }
  }

  // 6. Consent check
  const consent = (input.consentStatus ?? 'unknown').toLowerCase().trim()
  if (consent === 'revoked') {
    blocked.push('Consent has been explicitly revoked — cannot include in pilot')
  } else if (consent === 'unknown' || consent === '') {
    warnings.push('Consent status is unknown — verify consent before sending')
  } else if (!['explicit', 'implied'].includes(consent)) {
    warnings.push(`Unrecognized consent status: "${consent}" — treating as unknown`)
  }

  // 7. Vehicle interest — warning only
  const vehicle = input.vehicleName?.trim()
  if (!vehicle) {
    warnings.push('No vehicle of interest — message preview will use fallback copy')
  }

  // 8. Required name fields
  if (!input.firstName?.trim()) {
    blocked.push('First name is required')
  }

  // Determine final status
  let importStatus: PilotLeadImportStatus
  if (blocked.length > 0) {
    importStatus = 'blocked'
  } else if (warnings.length > 0) {
    importStatus = 'warning'
  } else {
    importStatus = 'eligible'
  }

  return {
    phone,
    importStatus,
    blockedReasons: blocked,
    warnings,
    duplicateOfLeadId,
    duplicateOfImportId,
  }
}

// ── Core import functions ──────────────────────────────────────────────────────

/**
 * Import an array of lead inputs for a tenant.
 * Validates each row (phone normalization, dedup, consent, opt-out)
 * and stores results in pilot_lead_imports.
 *
 * Does NOT enroll leads, does NOT send SMS.
 */
export async function importLeads(
  rows: LeadImportInput[],
  tenantId: string,
  importedBy: string,
): Promise<Array<typeof pilotLeadImports.$inferSelect>> {
  const seenPhones = new Map<string, string>()   // phone → importId
  const seenEmails = new Map<string, string>()   // email → importId
  const results: Array<typeof pilotLeadImports.$inferSelect> = []

  for (const input of rows) {
    const validation = await validateImportRow(input, tenantId, seenPhones, seenEmails)

    const now = new Date()
    const [inserted] = await db
      .insert(pilotLeadImports)
      .values({
        tenantId,
        firstName:           input.firstName?.trim() ?? '',
        lastName:            input.lastName?.trim() ?? '',
        phoneRaw:            input.phone,
        phone:               validation.phone,
        email:               input.email?.trim().toLowerCase() || null,
        vehicleOfInterest:   input.vehicleName?.trim() || null,
        leadSource:          input.leadSource?.trim() || null,
        originalInquiryAt:   parseOptionalDate(input.originalInquiryAt),
        consentStatus:       (input.consentStatus?.trim() || 'unknown'),
        consentSource:       input.consentSource?.trim() || null,
        consentCapturedAt:   parseOptionalDate(input.consentCapturedAt),
        smsConsentNotes:     input.smsConsentNotes?.trim() || null,
        crmSource:           input.crmSource?.trim() || 'manual',
        externalId:          input.externalId?.trim() || null,
        notes:               input.notes?.trim() || null,
        importStatus:        validation.importStatus,
        blockedReasons:      validation.blockedReasons.length > 0 ? validation.blockedReasons : null,
        warnings:            validation.warnings.length > 0 ? validation.warnings : null,
        duplicateOfLeadId:   validation.duplicateOfLeadId,
        duplicateOfImportId: validation.duplicateOfImportId,
        selectedForBatch:    false,
        importedBy,
        importedAt:          now,
        createdAt:           now,
        updatedAt:           now,
      })
      .returning()

    // Track for intra-session dedup
    if (validation.phone && !seenPhones.has(validation.phone)) {
      seenPhones.set(validation.phone, inserted.id)
    }
    const emailKey = input.email?.trim().toLowerCase()
    if (emailKey && !seenEmails.has(emailKey)) {
      seenEmails.set(emailKey, inserted.id)
    }

    results.push(inserted)
  }

  return results
}

/**
 * Parse a CSV string and import all rows for a tenant.
 */
export async function importLeadsFromCSV(
  csv: string,
  tenantId: string,
  importedBy: string,
): Promise<Array<typeof pilotLeadImports.$inferSelect>> {
  const rawRows = parseCSV(csv)
  const inputs  = rawRows.map(csvRowToImportInput)
  return importLeads(inputs, tenantId, importedBy)
}

/**
 * Return all pilot lead imports for a tenant, newest first.
 */
export async function getImportedLeads(
  tenantId: string,
): Promise<Array<typeof pilotLeadImports.$inferSelect>> {
  return db
    .select()
    .from(pilotLeadImports)
    .where(
      and(
        eq(pilotLeadImports.tenantId, tenantId),
      )
    )
    .orderBy(pilotLeadImports.createdAt)
}

/**
 * Validate a single row without writing to the DB.
 * Used by POST /validate.
 */
export async function validateSingleLead(
  input: LeadImportInput,
  tenantId: string,
): Promise<ImportValidationResult> {
  return validateImportRow(input, tenantId, new Map(), new Map())
}

// ── Selection ──────────────────────────────────────────────────────────────────

/**
 * Toggle selection state for a pilot lead import row.
 * Hard caps at FIRST_PILOT_CAP selected leads per tenant.
 * Blocked leads cannot be selected.
 */
export async function setLeadSelected(
  importId: string,
  selected: boolean,
  tenantId: string,
): Promise<{ ok: boolean; error?: string }> {
  const row = await db.query.pilotLeadImports.findFirst({
    where: and(
      eq(pilotLeadImports.id, importId),
      eq(pilotLeadImports.tenantId, tenantId),
    ),
  })
  if (!row) return { ok: false, error: 'Import row not found' }
  if (row.importStatus === 'blocked' || row.importStatus === 'excluded') {
    return { ok: false, error: `Cannot select a ${row.importStatus} lead` }
  }

  // First-pilot consent gate: unknown consent cannot be selected.
  // Import-time behavior is unchanged (unknown remains a warning, not a hard block at
  // import time). This is a selection-time rule specific to the first pilot.
  if (selected) {
    const consent = (row.consentStatus ?? 'unknown').toLowerCase().trim()
    if (consent === 'unknown' || consent === '') {
      return {
        ok: false,
        error: 'Cannot select a lead with unknown consent for the first pilot. ' +
               'Update consentStatus to "explicit" or "implied" before selecting.',
      }
    }
  }

  if (selected) {
    // Count currently selected leads
    const currentlySelected = await db
      .select()
      .from(pilotLeadImports)
      .where(and(
        eq(pilotLeadImports.tenantId, tenantId),
        eq(pilotLeadImports.selectedForBatch, true),
      ))
    if (currentlySelected.length >= FIRST_PILOT_CAP) {
      return { ok: false, error: `Cannot select more than ${FIRST_PILOT_CAP} leads for the first pilot` }
    }
  }

  await db
    .update(pilotLeadImports)
    .set({
      selectedForBatch: selected,
      importStatus:     selected ? 'selected' : (row.blockedReasons?.length ? 'blocked' : row.warnings?.length ? 'warning' : 'eligible'),
      updatedAt:        new Date(),
    })
    .where(eq(pilotLeadImports.id, importId))

  return { ok: true }
}

/**
 * Mark a lead import as excluded (soft delete).
 */
export async function excludeImportedLead(
  importId: string,
  tenantId: string,
): Promise<void> {
  await db
    .update(pilotLeadImports)
    .set({ importStatus: 'excluded', selectedForBatch: false, updatedAt: new Date() })
    .where(and(
      eq(pilotLeadImports.id, importId),
      eq(pilotLeadImports.tenantId, tenantId),
    ))
}

// ── Preview rendering ──────────────────────────────────────────────────────────

/**
 * Render message previews for a pilot lead import row against a given workflow.
 * Stores the result back on the import row.
 * Does NOT send anything.
 */
export async function renderImportLeadPreview(
  importId: string,
  workflowId: string,
  tenantId: string,
): Promise<PilotPreviewMessage[]> {
  const importRow = await db.query.pilotLeadImports.findFirst({
    where: and(
      eq(pilotLeadImports.id, importId),
      eq(pilotLeadImports.tenantId, tenantId),
    ),
  })
  if (!importRow) throw new Error(`Import row ${importId} not found`)

  const [workflow, tenant] = await Promise.all([
    db.query.workflows.findFirst({ where: eq(workflows.id, workflowId), with: { steps: true } }),
    db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }),
  ])
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`)

  // Pass all steps (previewWorkflow handles condition/assign filtering internally)
  const allSteps = (workflow.steps ?? [])
    .sort((a, b) => a.position - b.position)
    .map(s => ({ position: s.position, type: s.type as string, config: s.config }))

  const context = {
    firstName:         importRow.firstName,
    lastName:          importRow.lastName,
    dealershipName:    tenant?.name ?? 'Dealership',
    vehicleOfInterest: importRow.vehicleOfInterest ?? null,
    salespersonName:   null,
  }

  const previews = previewWorkflow(allSteps, context)

  const previewMessages: PilotPreviewMessage[] = previews
    .filter(p => p.type === 'send_sms')
    .map((p, i) => ({
      position:    p.position,
      type:        'send_sms',
      rendered:    p.rendered,
      usedFallback: p.usedFallback,
      delayHours:  p.delayHours,
      label:       p.label ?? `Step ${i + 1}`,
    }))

  // Store previews on the import row
  await db
    .update(pilotLeadImports)
    .set({ previewMessages, updatedAt: new Date() })
    .where(eq(pilotLeadImports.id, importId))

  return previewMessages
}

// ── Batch creation ─────────────────────────────────────────────────────────────

/**
 * Create a draft pilot batch from selected import rows.
 *
 * Rules:
 *   - Only import rows with importStatus 'selected' | 'eligible' | 'warning' can be included
 *   - Blocked rows are excluded
 *   - Maximum FIRST_PILOT_CAP leads
 *   - Batch is created with status='draft', isFirstPilot=true
 *   - Leads not already in the leads table are upserted (created)
 *   - pilot_batch_leads rows are created with approvedForSend=false
 *   - NO enrollments are created
 *   - NO Telnyx calls are made
 *
 * Returns the new pilotBatches.id.
 */
export async function createPilotBatchFromImport(
  params: CreateBatchParams,
): Promise<string> {
  const { tenantId, workflowId, createdBy, importIds } = params

  // Load the import rows
  const importRows = await db
    .select()
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      inArray(pilotLeadImports.id, importIds),
    ))

  // Filter to non-blocked rows only
  const eligible = importRows.filter(r =>
    ['selected', 'eligible', 'warning'].includes(r.importStatus) &&
    r.importStatus !== 'blocked' &&
    r.importStatus !== 'excluded'
  )

  if (eligible.length === 0) {
    throw new Error('No eligible leads selected — cannot create batch')
  }
  if (eligible.length > FIRST_PILOT_CAP) {
    throw new Error(`Cannot exceed ${FIRST_PILOT_CAP} leads in the first pilot batch`)
  }

  // First-pilot consent gate (defence-in-depth, mirrors the selection-time check).
  // Reject the entire batch if any lead has unknown or missing consent.
  // This is intentionally strict for the first pilot — it does not change how unknown
  // consent is handled at import time (still a warning, not a hard import block).
  const unknownConsentLeads = eligible.filter(r => {
    const c = (r.consentStatus ?? 'unknown').toLowerCase().trim()
    return c === 'unknown' || c === ''
  })
  if (unknownConsentLeads.length > 0) {
    const names = unknownConsentLeads.map(r => `${r.firstName} ${r.lastName}`).join(', ')
    throw new Error(
      `First-pilot consent check failed: ${unknownConsentLeads.length} lead(s) have unknown consent ` +
      `and cannot be included in the first pilot batch: ${names}. ` +
      'Update consentStatus to "explicit" or "implied" for each lead before creating the batch.'
    )
  }

  const now = new Date()

  // Upsert each import row into the leads table (create if not already there)
  const leadIdMap = new Map<string, string>() // importId → leadId

  for (const row of eligible) {
    if (row.leadId) {
      // Already promoted in a previous batch creation attempt
      leadIdMap.set(row.id, row.leadId)
      continue
    }

    // Check if a lead with this phone already exists for the tenant
    const existingLead = row.phone
      ? await db
          .select()
          .from(leads)
          .where(and(eq(leads.tenantId, tenantId), eq(leads.phone, row.phone)))
          .limit(1)
          .then(r => r[0] ?? null)
      : null

    if (existingLead) {
      leadIdMap.set(row.id, existingLead.id)
      // Link import row to existing lead
      await db
        .update(pilotLeadImports)
        .set({ leadId: existingLead.id, updatedAt: now })
        .where(eq(pilotLeadImports.id, row.id))
    } else {
      // Create a new lead record
      const [newLead] = await db
        .insert(leads)
        .values({
          tenantId,
          firstName:         row.firstName,
          lastName:          row.lastName,
          phone:             row.phone ?? row.phoneRaw,
          email:             row.email ?? null,
          vehicleOfInterest: row.vehicleOfInterest ?? null,
          crmSource:         row.crmSource ?? 'pilot_import',
          crmLeadId:         row.externalId ?? null,
          state:             'active',
          consentStatus:     row.consentStatus,
          consentSource:     row.consentSource ?? null,
          consentCapturedAt: row.consentCapturedAt ?? null,
          originalInquiryAt: row.originalInquiryAt ?? null,
          smsConsentNotes:   row.smsConsentNotes ?? null,
          doNotAutomate:     false,
          isTest:            false,
          needsHumanHandoff: false,
          metadata:          {},
          createdAt:         now,
          updatedAt:         now,
        })
        .returning()

      leadIdMap.set(row.id, newLead.id)
      await db
        .update(pilotLeadImports)
        .set({ leadId: newLead.id, updatedAt: now })
        .where(eq(pilotLeadImports.id, row.id))
    }
  }

  // Create the pilot batch in draft status — NOT approved, NOT sending
  const [batch] = await db
    .insert(pilotBatches)
    .values({
      tenantId,
      workflowId,
      status:         'draft',
      maxLeadCount:   FIRST_PILOT_CAP,
      createdBy,
      isFirstPilot:   true,
      firstPilotState: 'not_started',
      continuationRequired: false,
      auditRowVerified:     false,
      providerIdVerified:   false,
      liveSendCount:  0,
      blockedCount:   0,
      replyCount:     0,
      handoffCount:   0,
      createdAt:      now,
      updatedAt:      now,
    })
    .returning()

  // Create pilot_batch_leads rows — no enrollments, no sends
  for (const row of eligible) {
    const leadId = leadIdMap.get(row.id)
    if (!leadId) continue

    await db
      .insert(pilotBatchLeads)
      .values({
        batchId:          batch.id,
        leadId,
        eligibilityResult: (row.eligibilityResult as PilotEligibilityResult | null) ?? null,
        previewMessages:  (row.previewMessages as PilotPreviewMessage[] | null) ?? null,
        approvedForSend:  false,    // stays false until Phase 13 confirmation gate
        sendStatus:       'pending',
        createdAt:        now,
        updatedAt:        now,
      })
      .onConflictDoNothing()  // if somehow already in the batch, skip
  }

  return batch.id
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseOptionalDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

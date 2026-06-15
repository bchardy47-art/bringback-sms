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

import { and, eq, inArray, isNotNull, notInArray, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  leads, optOuts, pilotBatches, pilotBatchLeads, pilotLeadImports,
  workflows, workflowSteps, tenants,
  FIRST_PILOT_CAP,
  type AgeBucket,
  type PilotLeadImportStatus,
  type PilotEligibilityResult,
  type PilotPreviewMessage,
} from '@/lib/db/schema'
import { previewWorkflow } from '@/lib/workflows/preview'
import {
  classifyLeadAge,
  DEALER_BUCKET_LABEL,
  extractCrmDateWithSource,
  parseContactDate,
} from '@/lib/pilot/age-classification'
import { WORKFLOW_TEMPLATES } from '@/lib/workflows/templates'

// ── Types ──────────────────────────────────────────────────────────────────────

export type LeadImportInput = {
  firstName:         string
  lastName:          string
  phone:             string
  email?:            string | null
  vehicleName?:      string | null  // maps to vehicleOfInterest
  leadSource?:       string | null
  contactDate?:       string | null  // dealership's day-1 contact date; drives age bucket assignment
  contactDateSource?: string | null  // dealer-friendly label for the source column (e.g. "Using last activity date")
  originalInquiryAt?: string | null  // ISO string or parseable date string
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

// ── Cross-session dedupe types ────────────────────────────────────────────────
//
// Same CSV uploaded a second time should not silently add duplicate rows to
// the dealer's review queue. We pre-fetch the tenant's "active" pilot import
// rows (anything not currently `excluded` or `held` — same convention as the
// /dealer/import filter) and skip any input row whose normalized phone or
// email matches an active row.
//
// `excluded` and `held` rows are intentionally treated as inactive:
//   - `excluded` means the dealer manually X'd it out; let them re-add it.
//   - `held` means too-fresh; re-uploading is harmless and lets classification
//     run again.

/** A single input row that was NOT written because the tenant already has
 *  an active pilot_lead_imports row with a matching normalized phone or
 *  email. The dealer-facing UI surfaces these as "already in your queue". */
export type ImportRunSkipped = {
  /** The original input row. */
  input:               LeadImportInput
  /** Normalized E.164 phone for the input row, if normalisation succeeded. */
  phone:               string | null
  /** Lowercased / trimmed email for the input row, if present. */
  email:               string | null
  /** Which field caused the skip. */
  reason:              'duplicate_phone' | 'duplicate_email' | 'duplicate_phone_and_email'
  /** The existing pilot_lead_imports.id that matched. */
  duplicateOfImportId: string | null
}

/** Dealer-friendly summary of the run. */
export type ImportRunSummary = {
  /** Rows submitted by the caller. */
  totalInput:      number
  /** New pilot_lead_imports rows written this run. */
  created:         number
  /** Input rows skipped because the tenant already had a matching active row. */
  alreadyInQueue:  number
  /** Counts of new rows by importStatus (sums to `created`). */
  eligible:        number
  warning:         number
  needsReview:     number
  blocked:         number
  held:            number
  selected:        number
}

/** Full result of an importLeads run — extends what the previous shape
 *  returned (the inserted rows) with the cross-session dedupe data. */
export type ImportRunResult = {
  inserted: Array<typeof pilotLeadImports.$inferSelect>
  skipped:  ImportRunSkipped[]
  summary:  ImportRunSummary
}

/**
 * Pure helper — decide whether an input row should be skipped because the
 * tenant already has an active pilot import row with the same phone/email.
 *
 * Extracted as a pure function so it can be tested without a database.
 */
export function classifyImportDedupe(
  phone:        string | null,
  email:        string | null,
  tenantPhones: ReadonlyMap<string, string>,
  tenantEmails: ReadonlyMap<string, string>,
): { duplicate: false } | {
  duplicate:           true
  reason:              ImportRunSkipped['reason']
  duplicateOfImportId: string | null
} {
  const phoneMatch = phone ? tenantPhones.get(phone) ?? null : null
  const emailMatch = email && isValidNormalizedEmail(email)
    ? tenantEmails.get(email) ?? null
    : null
  if (!phoneMatch && !emailMatch) return { duplicate: false }

  const reason: ImportRunSkipped['reason'] =
    phoneMatch && emailMatch ? 'duplicate_phone_and_email' :
    phoneMatch                ? 'duplicate_phone' :
                                'duplicate_email'

  return {
    duplicate:           true,
    reason,
    duplicateOfImportId: phoneMatch ?? emailMatch ?? null,
  }
}

/**
 * Pure helper — build the dealer-facing summary from a list of newly-inserted
 * rows and the count of rows that were skipped as duplicates. Pure so it can
 * be unit-tested.
 */
export function summarizeImportRun(
  inserted:       ReadonlyArray<{ importStatus: string }>,
  skippedCount:   number,
  totalInputCount: number,
): ImportRunSummary {
  const byStatus = (s: string) => inserted.filter(r => r.importStatus === s).length
  return {
    totalInput:     totalInputCount,
    created:        inserted.length,
    alreadyInQueue: skippedCount,
    eligible:       byStatus('eligible'),
    warning:        byStatus('warning'),
    needsReview:    byStatus('needs_review'),
    blocked:        byStatus('blocked'),
    held:           byStatus('held'),
    selected:       byStatus('selected'),
  }
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

/**
 * Minimal format check for a normalized (trimmed, lowercased) email.
 * Requires at least one character before @, and a domain with a dot and
 * at least 3 characters (e.g. "a.b"). Does not validate TLD length or
 * international formats — just filters clearly malformed values so they
 * don't participate in dedupe matching.
 */
export function isValidNormalizedEmail(email: string): boolean {
  const at = email.indexOf('@')
  if (at < 1) return false
  const domain = email.slice(at + 1)
  return domain.includes('.') && domain.length >= 3
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

  // Source-type-aware CRM date extraction. Detects lead type (internet/lot/unknown)
  // from the source field, applies the appropriate priority order, and returns a
  // dealer-friendly label when a non-obvious fallback column was used.
  const crmDate = extractCrmDateWithSource(row)
  const contactDate = crmDate.date ? crmDate.date.toISOString() : null

  return {
    firstName:          get('firstName', 'first_name', 'First Name', 'firstname') ?? '',
    lastName:           get('lastName', 'last_name', 'Last Name', 'lastname') ?? '',
    phone:              get('phone', 'Phone', 'mobile', 'Mobile', 'cell') ?? '',
    email:              get('email', 'Email') ?? null,
    vehicleName:        get('vehicleName', 'vehicle_name', 'vehicleInterest', 'vehicle_of_interest', 'Vehicle') ?? null,
    leadSource:         get('leadSource', 'lead_source', 'source', 'Source') ?? null,
    contactDate,
    contactDateSource:  crmDate.sourceLabel ?? null,
    originalInquiryAt:  get('originalInquiryAt', 'original_inquiry_at', 'inquiryDate', 'inquiry_date') ?? null,
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
  if (email && isValidNormalizedEmail(email) && seenEmails.has(email)) {
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
 * Cross-session dedupe: input rows whose normalized phone or email match an
 * existing active pilot_lead_imports row for this tenant are skipped without
 * inserting a new row. They appear in `result.skipped` instead, and the
 * dealer UI surfaces them as "already in your queue". Active = anything not
 * currently in importStatus `excluded` or `held` — mirroring the convention
 * used by /dealer/import.
 *
 * Returns `{ inserted, skipped, summary }`. Callers that previously treated
 * the return as the inserted-row array now read `result.inserted`.
 *
 * Does NOT enroll leads, does NOT send SMS.
 */
export async function importLeads(
  rows: LeadImportInput[],
  tenantId: string,
  importedBy: string,
): Promise<ImportRunResult> {
  const seenPhones = new Map<string, string>()   // phone → importId
  const seenEmails = new Map<string, string>()   // email → importId
  const results: Array<typeof pilotLeadImports.$inferSelect> = []
  const skipped: ImportRunSkipped[] = []

  // ── Pre-fetch tenant's active pilot import rows for cross-session dedupe ──
  // We read only the three columns we need so the query is cheap even on
  // tenants with thousands of rows.
  const existingActiveRows = await db
    .select({
      id:    pilotLeadImports.id,
      phone: pilotLeadImports.phone,
      email: pilotLeadImports.email,
    })
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      notInArray(pilotLeadImports.importStatus, ['excluded', 'held']),
    ))

  const tenantPhones = new Map<string, string>()   // phone → existing importId
  const tenantEmails = new Map<string, string>()   // email → existing importId
  for (const row of existingActiveRows) {
    if (row.phone) tenantPhones.set(row.phone, row.id)
    if (row.email) tenantEmails.set(row.email, row.id)
  }

  // Pre-fetch all bucket workflows for this tenant (at most 4, one per bucket)
  const bucketWorkflowRows = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.tenantId, tenantId), isNotNull(workflows.ageBucket)))
  const bucketWorkflows = new Map<AgeBucket, typeof bucketWorkflowRows[0]>(
    bucketWorkflowRows
      .filter(w => w.ageBucket != null)
      .map(w => [w.ageBucket as AgeBucket, w]),
  )

  const today = new Date()

  for (const input of rows) {
    // ── Cross-session dedupe — runs before validation/insert so we save
    //    the per-row DB lookups when the row is going to be skipped anyway.
    const inputPhone = normalizePhone(input.phone)
    const inputEmail = input.email?.trim().toLowerCase() || null
    const dedupe = classifyImportDedupe(inputPhone, inputEmail, tenantPhones, tenantEmails)
    if (dedupe.duplicate) {
      skipped.push({
        input,
        phone:               inputPhone,
        email:               inputEmail,
        reason:              dedupe.reason,
        duplicateOfImportId: dedupe.duplicateOfImportId,
      })
      continue
    }

    const validation = await validateImportRow(input, tenantId, seenPhones, seenEmails)

    // ── Age classification ─────────────────────────────────────────────────────
    // Use contactDate if present; fall back to originalInquiryAt as a proxy.
    const rawDateStr = input.contactDate || input.originalInquiryAt || null
    const parsedContactDate = parseContactDate(rawDateStr)
    const ageResult = classifyLeadAge(parsedContactDate, today)

    // Determine final import status — age classification can promote eligible/warning → held,
    // but never overrides an existing blocked/excluded status.
    let finalStatus: PilotLeadImportStatus = validation.importStatus
    if (finalStatus !== 'blocked' && finalStatus !== 'excluded') {
      if (ageResult.classification === 'too_fresh') {
        finalStatus = 'held'
      }
      // needs_review: keep existing status but add a warning (handled below)
    }

    // Merge validation warnings with any age-classification warning.
    // classifyLeadAge() already returns a needs_review warning string when
    // contactDate is missing or unparseable — no need to push a second one
    // that says the same thing in different words.
    const allWarnings = [...validation.warnings]
    if (ageResult.warning) allWarnings.push(ageResult.warning)

    // Emit an informational date-source note when a non-obvious fallback
    // column was used for the revival date (e.g. last_customer_reply_at
    // instead of inquiry_date). Prefix "date-source: " so the dealer UI
    // can render it as a dim info note rather than an amber warning.
    if (input.contactDateSource && parsedContactDate) {
      allWarnings.push(`date-source: ${input.contactDateSource}`)
    }
    // Missing or unparseable date → 'needs_review' status. Previously this
    // promoted eligible → warning, which let the dealer accidentally select
    // a date-less row that then failed downstream batch creation with a
    // confusing "no auto-assigned workflow" error. Promoting to needs_review
    // (and rejecting selection of needs_review rows in setLeadSelected) puts
    // the failure in front of the dealer at the right step.
    if (
      ageResult.classification === 'needs_review' &&
      !parsedContactDate &&
      finalStatus !== 'blocked' &&
      finalStatus !== 'excluded'
    ) {
      finalStatus = 'needs_review'
    }

    // Resolve the bucket workflow (null if lead is held, needs_review, or no workflow configured)
    const assignedWorkflow = ageResult.ageBucket
      ? (bucketWorkflows.get(ageResult.ageBucket) ?? null)
      : null

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
        contactDate:         parsedContactDate,
        originalInquiryAt:   parseOptionalDate(input.originalInquiryAt),
        leadAgeDays:         ageResult.leadAgeDays,
        ageBucket:           ageResult.ageBucket,
        enrollAfter:         ageResult.enrollAfter,
        assignedWorkflowId:  assignedWorkflow?.id ?? null,
        consentStatus:       (input.consentStatus?.trim() || 'unknown'),
        consentSource:       input.consentSource?.trim() || null,
        consentCapturedAt:   parseOptionalDate(input.consentCapturedAt),
        smsConsentNotes:     input.smsConsentNotes?.trim() || null,
        crmSource:           input.crmSource?.trim() || 'manual',
        externalId:          input.externalId?.trim() || null,
        notes:               input.notes?.trim() || null,
        importStatus:        finalStatus,
        blockedReasons:      validation.blockedReasons.length > 0 ? validation.blockedReasons : null,
        warnings:            allWarnings.length > 0 ? allWarnings : null,
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

    // Also extend the tenant-wide dedupe maps so the next row in this same
    // import (e.g. the same CSV listing the same phone twice) is treated as
    // a duplicate against the row we just wrote, not silently inserted twice.
    if (validation.phone && !tenantPhones.has(validation.phone)) {
      tenantPhones.set(validation.phone, inserted.id)
    }
    if (emailKey && !tenantEmails.has(emailKey)) {
      tenantEmails.set(emailKey, inserted.id)
    }

    results.push(inserted)
  }

  return {
    inserted: results,
    skipped,
    summary:  summarizeImportRun(results, skipped.length, rows.length),
  }
}

/**
 * Parse a CSV string and import all rows for a tenant. Returns the same
 * {inserted, skipped, summary} shape as importLeads() so the caller can
 * surface the cross-session dedupe count to the dealer.
 */
export async function importLeadsFromCSV(
  csv: string,
  tenantId: string,
  importedBy: string,
): Promise<ImportRunResult> {
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

  // needs_review (missing/invalid contact date) → no auto-assigned workflow,
  // so this lead cannot land in a bucket and would only fail downstream batch
  // creation. Reject selection here with a clear, dealer-actionable error.
  if (selected && row.importStatus === 'needs_review') {
    return {
      ok: false,
      error: 'This lead is missing a parseable contact date. ' +
             'Re-import with a recognised date column (e.g. Lead Date, Created Date, ' +
             'Inquiry Date) so DLR can assign it to a campaign bucket.',
    }
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

  // Auto-generate message previews for the batch review page.
  // Renders each lead's workflow messages so the review page is never blank.
  // Non-fatal: if preview fails, the batch is still created and the review
  // page shows an empty preview rather than blocking the entire flow.
  const previewMap = new Map<string, PilotPreviewMessage[]>()
  for (const row of eligible) {
    const existing = (row.previewMessages as PilotPreviewMessage[] | null) ?? []
    if (existing.length > 0) {
      previewMap.set(row.id, existing)
    } else {
      try {
        const previews = await renderImportLeadPreview(row.id, workflowId, tenantId)
        previewMap.set(row.id, previews)
      } catch {
        // Non-fatal — leave preview empty, do not fail batch creation
      }
    }
  }

  // Create pilot_batch_leads rows — no enrollments, no sends
  for (const row of eligible) {
    const leadId = leadIdMap.get(row.id)
    if (!leadId) continue

    const previews = previewMap.get(row.id) ?? []
    await db
      .insert(pilotBatchLeads)
      .values({
        batchId:          batch.id,
        leadId,
        eligibilityResult: (row.eligibilityResult as PilotEligibilityResult | null) ?? null,
        previewMessages:  previews.length > 0 ? previews : null,
        approvedForSend:  false,    // stays false until live send approval
        sendStatus:       'pending',
        createdAt:        now,
        updatedAt:        now,
      })
      .onConflictDoNothing()  // if somehow already in the batch, skip
  }

  return batch.id
}

// ── Bucket-aware multi-batch creation ─────────────────────────────────────────

export type BucketBatchResult = {
  batchId:      string
  workflowId:   string
  workflowName: string
  ageBucket:    AgeBucket | null
  leadCount:    number
}

/**
 * Auto-create one draft pilot batch per age bucket from the selected import rows.
 *
 * Groups selected leads by ageBucket. For each bucket present in the selection,
 * resolves (or auto-provisions) a tenant-level workflow tagged with that bucket
 * and creates one draft pilotBatch against it. Auto-provisioning is the fix
 * for the long-standing dealer-import dead-end where a freshly onboarded tenant
 * had bucket-classified leads but no per-bucket workflow rows yet, so Step 3
 * silently refused to create a draft. See ensureBucketWorkflow() for the
 * safety properties of the provisioned workflow (isActive=false,
 * approvedForLive=false, activationStatus='draft').
 *
 * Returns an array of batch results, one per bucket group created.
 */
export async function createBucketsFromImport(
  tenantId: string,
  importIds: string[],
  createdBy: string,
): Promise<BucketBatchResult[]> {
  if (!importIds.length) throw new Error('No import IDs provided')

  // Load the requested import rows
  const importRows = await db
    .select()
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      inArray(pilotLeadImports.id, importIds),
    ))

  // A row can be included in a draft batch if it has an ageBucket (which means
  // age-classification placed it in a 14-30 / 31-60 / 61-90 / 91+ window) AND
  // it is in a batchable status. assignedWorkflowId is intentionally NOT a
  // precondition — see the function-level comment.
  const assignable = importRows.filter(
    r => r.ageBucket != null &&
    ['selected', 'eligible', 'warning'].includes(r.importStatus),
  )

  if (assignable.length === 0) {
    // Build a precise reason for each lead so the dealer gets a row-level
    // explanation instead of the generic "re-import with a contact date" copy.
    const reasons = importRows
      .map(r => {
        if (r.importStatus === 'needs_review') {
          return `${r.firstName} ${r.lastName}: missing a parseable contact date`
        }
        if (r.importStatus === 'held') {
          const after = r.enrollAfter ? new Date(r.enrollAfter).toISOString().slice(0, 10) : 'soon'
          return `${r.firstName} ${r.lastName}: held until ${after} (within the 14-day fresh-lead window)`
        }
        if (r.importStatus === 'blocked' || r.importStatus === 'excluded') {
          return `${r.firstName} ${r.lastName}: ${r.importStatus}`
        }
        if (r.ageBucket == null) {
          return `${r.firstName} ${r.lastName}: no age bucket assignment`
        }
        return `${r.firstName} ${r.lastName}: not in a batchable status (${r.importStatus})`
      })
      .join('; ')
    throw new Error(
      `No leads in the provided selection can be grouped into a campaign yet. ${reasons}.`,
    )
  }

  // Group by ageBucket
  const groups = new Map<AgeBucket, typeof assignable>()
  for (const row of assignable) {
    const bucket = row.ageBucket as AgeBucket
    if (!groups.has(bucket)) groups.set(bucket, [])
    groups.get(bucket)!.push(row)
  }

  // Resolve or provision a workflow per bucket present in the selection.
  // ensureBucketWorkflow() is idempotent — it returns the existing per-tenant
  // bucket workflow when present, or creates one in a strictly safe state.
  const bucketToWorkflowId = new Map<AgeBucket, string>()
  for (const bucket of Array.from(groups.keys())) {
    const wfId = await ensureBucketWorkflow(tenantId, bucket)
    bucketToWorkflowId.set(bucket, wfId)
  }

  // Persist the resolved workflow id back onto any row that didn't have one yet
  // so the lead row UI in the next render shows the bucket workflow link.
  const leadsNeedingAssignment = assignable.filter(r => r.assignedWorkflowId == null)
  if (leadsNeedingAssignment.length > 0) {
    const updateAt = new Date()
    for (const row of leadsNeedingAssignment) {
      const wfId = bucketToWorkflowId.get(row.ageBucket as AgeBucket)
      if (!wfId) continue
      await db
        .update(pilotLeadImports)
        .set({ assignedWorkflowId: wfId, updatedAt: updateAt })
        .where(eq(pilotLeadImports.id, row.id))
    }
  }

  // Fetch the workflow rows so we can populate workflowName + ageBucket in results
  const workflowIds = Array.from(bucketToWorkflowId.values())
  const workflowRows = await db
    .select({ id: workflows.id, name: workflows.name, ageBucket: workflows.ageBucket })
    .from(workflows)
    .where(inArray(workflows.id, workflowIds))
  const workflowMap = new Map(workflowRows.map(w => [w.id, w]))

  // Create one draft batch per bucket group
  const results: BucketBatchResult[] = []
  for (const [bucket, rows] of Array.from(groups.entries())) {
    const workflowId = bucketToWorkflowId.get(bucket)
    if (!workflowId) continue   // unreachable — ensureBucketWorkflow throws on failure
    const batchId = await createPilotBatchFromImport({
      tenantId,
      workflowId,
      createdBy,
      importIds: rows.map((r: { id: string }) => r.id),
    })
    const wf = workflowMap.get(workflowId)
    results.push({
      batchId,
      workflowId,
      workflowName: wf?.name ?? DEALER_BUCKET_LABEL[bucket],
      ageBucket:    bucket,
      leadCount:    rows.length,
    })
  }

  // Sort by bucket so results come back in A→D order
  results.sort((a, b) => (a.ageBucket ?? 'z').localeCompare(b.ageBucket ?? 'z'))

  return results
}

// ── Bucket workflow provisioning ──────────────────────────────────────────────

/**
 * Slug used for the fallback template cloned when a tenant has no per-bucket
 * workflow for a given AgeBucket. The "Old Internet Lead Revival" template
 * has the broadest 3-step revival shape and is dry-run-safe (no triggers,
 * no live sends until approved).
 */
const BUCKET_FALLBACK_TEMPLATE_KEY = 'internet_lead_revival'

/**
 * Find the tenant's existing workflow for the given AgeBucket, or create one.
 *
 * The auto-created workflow is **strictly draft-safe**:
 *   - isActive            = false  → no trigger auto-enrolls leads
 *   - isTemplate          = false  → it is a real per-tenant workflow, not a library entry
 *   - approvedForLive     = false  → live sends remain blocked
 *   - manualReviewRequired= true   → forces human review before activation
 *   - activationStatus    = 'draft'
 *
 * Steps are cloned from WORKFLOW_TEMPLATES[BUCKET_FALLBACK_TEMPLATE_KEY] so
 * the draft batch built on top of this workflow has meaningful preview copy
 * the dealer can review and edit before approval.
 */
export async function ensureBucketWorkflow(
  tenantId: string,
  ageBucket: AgeBucket,
): Promise<string> {
  // 1. Existing per-tenant bucket workflow → return it
  const existing = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.tenantId, tenantId), eq(workflows.ageBucket, ageBucket)))
    .limit(1)
    .then(r => r[0] ?? null)
  if (existing) return existing.id

  // 2. Clone the fallback template into a new draft workflow tagged with the bucket
  const fallback = WORKFLOW_TEMPLATES.find(t => t.key === BUCKET_FALLBACK_TEMPLATE_KEY)
  if (!fallback) {
    throw new Error(
      `Cannot auto-provision a bucket-${ageBucket} workflow: ` +
      `fallback template "${BUCKET_FALLBACK_TEMPLATE_KEY}" missing from WORKFLOW_TEMPLATES.`,
    )
  }

  const bucketLabel = DEALER_BUCKET_LABEL[ageBucket]
  const [created] = await db
    .insert(workflows)
    .values({
      tenantId,
      name:                   bucketLabel,
      description:
        `Auto-provisioned campaign group for the ${bucketLabel.toLowerCase()} bucket. ` +
        'Message copy was cloned from the default revival template — edit and approve ' +
        'before any live sends.',
      triggerType:            fallback.triggerType,
      triggerConfig:          fallback.triggerConfig,
      isActive:               false,
      isTemplate:             false,
      key:                    `bucket_${ageBucket}_auto`,
      ageBucket,
      approvedForLive:        false,
      requiresOptOutLanguage: true,
      manualReviewRequired:   true,
      activationStatus:       'draft',
    })
    .returning()

  if (fallback.steps.length > 0) {
    await db.insert(workflowSteps).values(
      fallback.steps.map(s => ({
        workflowId: created.id,
        position:   s.position,
        type:       s.type as 'send_sms' | 'condition' | 'assign',
        config:     s.config as never,
      })),
    )
  }

  return created.id
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseOptionalDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

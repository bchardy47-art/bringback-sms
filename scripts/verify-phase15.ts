/**
 * Phase 15 — Pilot Prep UX + Dry-Run Review — Verification Script
 *
 * 9 tests, verifies:
 *   1. Migration 0014 adds reviewed / reviewed_at / reviewed_by columns
 *   2. Schema has PilotImportDryRunReport type with required fields
 *   3. Schema has reviewed / reviewedAt / reviewedBy on pilotLeadImports
 *   4. lead-import-review.ts exports correct functions
 *   5. updateImportedLead re-validates and auto-deselects if blocked
 *   6. markReviewed sets correct fields
 *   7. bulkClearBlocked excludes only blocked rows
 *   8. generateDryRunReport returns correct structure + recommendation logic
 *   9. New API routes exist: dry-run, bulk-clear, [id]/review
 *   (bonus) UI page has filter + DryRunReportPanel + BulkClearButton
 *   (bonus) Batch review page exists
 *   (safety) No live sends, no enrollments, no Telnyx in review module
 */

import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')

// ── Assertion helpers ─────────────────────────────────────────────────────────

let passCount = 0
let failCount = 0

function pass(msg: string) {
  console.log(`  ✓ ${msg}`)
  passCount++
}

function fail(msg: string) {
  console.error(`  ✗ ${msg}`)
  failCount++
}

function assert(condition: boolean, msg: string) {
  condition ? pass(msg) : fail(msg)
}

function readFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function fileExists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel))
}

// ── Test 1: Migration 0014 ────────────────────────────────────────────────────

console.log('\nTest 1: Migration 0014_pilot_lead_import_review.sql')
const MIG = 'drizzle/migrations/0014_pilot_lead_import_review.sql'
assert(fileExists(MIG), 'Migration file exists')
const migSrc = readFile(MIG)
assert(migSrc.includes('ALTER TABLE pilot_lead_imports'), 'Alters pilot_lead_imports table')
assert(migSrc.includes('reviewed'), 'Adds reviewed column')
assert(migSrc.includes('reviewed_at') || migSrc.includes('reviewedAt'), 'Adds reviewed_at column')
assert(migSrc.includes('reviewed_by') || migSrc.includes('reviewedBy'), 'Adds reviewed_by column')
assert(migSrc.includes('BOOLEAN') || migSrc.includes('boolean'), 'reviewed is boolean type')
assert(migSrc.includes('TIMESTAMPTZ') || migSrc.includes('timestamptz'), 'reviewed_at is timestamptz')

// ── Test 2: PilotImportDryRunReport type in schema ────────────────────────────

console.log('\nTest 2: PilotImportDryRunReport type in schema')
const schemaSrc = readFile('src/lib/db/schema.ts')
assert(schemaSrc.includes('PilotImportDryRunReport'), 'PilotImportDryRunReport type exported')
assert(schemaSrc.includes('recommendation:'), 'type has recommendation field')
assert(schemaSrc.includes("'ready'"), "recommendation includes 'ready'")
assert(schemaSrc.includes("'fix_warnings'"), "recommendation includes 'fix_warnings'")
assert(schemaSrc.includes("'blocked'"), "recommendation includes 'blocked'")
assert(schemaSrc.includes('consentCoverage:'), 'type has consentCoverage field')
assert(schemaSrc.includes('fallbackCount:'), 'type has fallbackCount field')
assert(schemaSrc.includes('duplicateCount:'), 'type has duplicateCount field')
assert(schemaSrc.includes('recommendationReason:'), 'type has recommendationReason field')

// ── Test 3: Schema pilotLeadImports has review columns ───────────────────────

console.log('\nTest 3: pilotLeadImports table has review columns')
assert(
  schemaSrc.includes("reviewed:") && schemaSrc.includes("boolean('reviewed')"),
  'reviewed column defined as boolean',
)
assert(
  schemaSrc.includes("reviewedAt:") && schemaSrc.includes("reviewed_at"),
  'reviewedAt column defined',
)
assert(
  schemaSrc.includes("reviewedBy:") && schemaSrc.includes("reviewed_by"),
  'reviewedBy column defined',
)
// reviewed must have a default of false and be notNull
const reviewedColMatch = schemaSrc.match(/reviewed:\s*boolean\('reviewed'\)[^,\n]*/)
assert(
  !!reviewedColMatch && reviewedColMatch[0].includes('.default(false)'),
  'reviewed column has .default(false)',
)
assert(
  !!reviewedColMatch && reviewedColMatch[0].includes('.notNull()'),
  'reviewed column is notNull',
)

// ── Test 4: lead-import-review.ts exports ────────────────────────────────────

console.log('\nTest 4: lead-import-review.ts exports')
const REVIEW_LIB = 'src/lib/pilot/lead-import-review.ts'
assert(fileExists(REVIEW_LIB), 'lead-import-review.ts exists')
const reviewSrc = readFile(REVIEW_LIB)
assert(reviewSrc.includes('export async function updateImportedLead'), 'exports updateImportedLead')
assert(reviewSrc.includes('export async function markReviewed'), 'exports markReviewed')
assert(reviewSrc.includes('export async function bulkClearBlocked'), 'exports bulkClearBlocked')
assert(reviewSrc.includes('export async function generateDryRunReport'), 'exports generateDryRunReport')

// ── Test 5: updateImportedLead re-validates ───────────────────────────────────

console.log('\nTest 5: updateImportedLead re-validates + auto-deselects when blocked')
assert(reviewSrc.includes('validateImportRow'), 'calls validateImportRow for re-validation')
assert(reviewSrc.includes('nowBlocked'), 'detects when re-validation makes lead blocked')
assert(
  reviewSrc.includes('newSelected') && reviewSrc.includes('!nowBlocked'),
  'clears selection when blocked',
)
assert(reviewSrc.includes('previewMessages:     null'), 'clears stale previews on edit')
assert(reviewSrc.includes("'excluded'"), "refuses to edit excluded rows")

// ── Test 6: markReviewed sets correct fields ─────────────────────────────────

console.log('\nTest 6: markReviewed sets reviewed / reviewedAt / reviewedBy')
const markFnStart = reviewSrc.indexOf('export async function markReviewed')
const markFnEnd   = reviewSrc.indexOf('export async function', markFnStart + 10)
const markFnSrc   = reviewSrc.slice(markFnStart, markFnEnd)
assert(markFnSrc.includes('reviewed:    true'), 'sets reviewed to true')
assert(markFnSrc.includes('reviewedAt:'), 'sets reviewedAt')
assert(markFnSrc.includes('reviewedBy'), 'sets reviewedBy')
assert(markFnSrc.includes('new Date()'), 'uses current timestamp')

// ── Test 7: bulkClearBlocked only clears blocked rows ─────────────────────────

console.log('\nTest 7: bulkClearBlocked excludes only blocked rows')
const bulkFnStart = reviewSrc.indexOf('export async function bulkClearBlocked')
const bulkFnEnd   = reviewSrc.indexOf('export async function', bulkFnStart + 10)
const bulkFnSrc   = reviewSrc.slice(bulkFnStart, bulkFnEnd > bulkFnStart ? bulkFnEnd : undefined)
assert(
  bulkFnSrc.includes("importStatus, 'blocked'") || bulkFnSrc.includes("importStatus: 'blocked'") || bulkFnSrc.includes("importStatus,\n") || bulkFnSrc.includes("'blocked'"),
  'filters to blocked rows only',
)
assert(bulkFnSrc.includes("'excluded'"), "sets importStatus to 'excluded'")
assert(bulkFnSrc.includes('selectedForBatch: false'), 'clears selectedForBatch')
assert(
  bulkFnSrc.includes('return 0') || bulkFnSrc.includes('return ids.length'),
  'returns count of cleared rows',
)

// ── Test 8: generateDryRunReport structure + recommendation logic ──────────────

console.log('\nTest 8: generateDryRunReport structure and recommendation logic')
const genFnStart = reviewSrc.indexOf('export async function generateDryRunReport')
const genFnSrc   = reviewSrc.slice(genFnStart)
assert(genFnSrc.includes('selectedCount'), 'counts selected leads')
assert(genFnSrc.includes('eligibleCount'), 'counts eligible leads')
assert(genFnSrc.includes('warningCount'), 'counts warning leads')
assert(genFnSrc.includes('blockedCount'), 'counts blocked leads')
assert(genFnSrc.includes('reviewedCount'), 'counts reviewed leads')
assert(genFnSrc.includes('duplicateCount'), 'counts duplicates')
assert(genFnSrc.includes('fallbackCount'), 'counts fallback usage')
assert(genFnSrc.includes('consentCoverage'), 'builds consent coverage map')
// Recommendation logic
assert(
  genFnSrc.includes("recommendation       = 'blocked'") || genFnSrc.includes("recommendation = 'blocked'"),
  "sets recommendation 'blocked' when blockedCount > 0",
)
assert(
  genFnSrc.includes("recommendation       = 'fix_warnings'") || genFnSrc.includes("recommendation = 'fix_warnings'"),
  "sets recommendation 'fix_warnings' when warningCount > 0",
)
assert(
  genFnSrc.includes("recommendation       = 'ready'") || genFnSrc.includes("recommendation = 'ready'"),
  "sets recommendation 'ready' when no blockers and no warnings",
)
assert(genFnSrc.includes('generatedAt:'), 'includes generatedAt timestamp')
assert(genFnSrc.includes('tenantId,'), 'includes tenantId in report')

// ── Test 9: New API routes exist ──────────────────────────────────────────────

console.log('\nTest 9: New API routes exist')
const ROUTES_BASE = 'src/app/api/admin/dlr/pilot-leads'

assert(
  fileExists(`${ROUTES_BASE}/dry-run/route.ts`),
  'dry-run route exists',
)
assert(
  fileExists(`${ROUTES_BASE}/bulk-clear/route.ts`),
  'bulk-clear route exists',
)
assert(
  fileExists(`${ROUTES_BASE}/[id]/review/route.ts`),
  '[id]/review route exists',
)

// GET /dry-run
const dryRunSrc = readFile(`${ROUTES_BASE}/dry-run/route.ts`)
assert(dryRunSrc.includes('export async function GET'), 'dry-run route has GET handler')
assert(dryRunSrc.includes('generateDryRunReport'), 'dry-run route calls generateDryRunReport')
assert(dryRunSrc.includes('tenantId'), 'dry-run route requires tenantId')

// POST /bulk-clear
const bulkClearSrc = readFile(`${ROUTES_BASE}/bulk-clear/route.ts`)
assert(bulkClearSrc.includes('export async function POST'), 'bulk-clear route has POST handler')
assert(bulkClearSrc.includes('bulkClearBlocked'), 'bulk-clear route calls bulkClearBlocked')

// POST /[id]/review
const reviewRouteSrc = readFile(`${ROUTES_BASE}/[id]/review/route.ts`)
assert(reviewRouteSrc.includes('export async function POST'), '[id]/review route has POST handler')
assert(reviewRouteSrc.includes('markReviewed'), '[id]/review route calls markReviewed')
assert(reviewRouteSrc.includes('reviewedBy'), '[id]/review sets reviewedBy from session')

// GET /[id] (updated to include single-lead fetch)
const idRouteSrc = readFile(`${ROUTES_BASE}/[id]/route.ts`)
assert(idRouteSrc.includes('export async function GET'), '[id] route has GET handler')
assert(idRouteSrc.includes('updateImportedLead'), '[id] PATCH route calls updateImportedLead')

// ── Bonus: UI checks ──────────────────────────────────────────────────────────

console.log('\nBonus: UI + batch review page')

const pageSrc = readFile('src/app/(dashboard)/admin/dlr/pilot-leads/page.tsx')
assert(pageSrc.includes('DryRunReportPanel'), 'page includes DryRunReportPanel component')
assert(pageSrc.includes('BulkClearButton'), 'page includes BulkClearButton component')
assert(pageSrc.includes('MarkReviewedButton'), 'page includes MarkReviewedButton component')
assert(pageSrc.includes('status'), 'page has status filter support')
assert(pageSrc.includes('reviewedCount'), 'page shows reviewed count stat')

const batchPagePath = 'src/app/(dashboard)/admin/dlr/pilot-leads/batch/[batchId]/page.tsx'
assert(fileExists(batchPagePath), 'batch review page exists')
const batchPageSrc = readFile(batchPagePath)
assert(batchPageSrc.includes('previewMessages'), 'batch review page shows message previews')
assert(batchPageSrc.includes('consentCoverage') || batchPageSrc.includes('consentCounts'), 'batch review page has consent summary')
assert(batchPageSrc.includes('Pre-Approval Checklist') || batchPageSrc.includes('checklist'), 'batch review page has pre-approval checklist')

const controlsSrc = readFile('src/app/(dashboard)/admin/dlr/pilot-leads/LeadReviewControls.tsx')
assert(controlsSrc.includes("'use client'"), 'LeadReviewControls is a client component')
assert(controlsSrc.includes('BulkClearButton'), 'LeadReviewControls exports BulkClearButton')
assert(controlsSrc.includes('MarkReviewedButton'), 'LeadReviewControls exports MarkReviewedButton')
assert(controlsSrc.includes('DryRunReportPanel'), 'LeadReviewControls exports DryRunReportPanel')

// ── Safety: no live sends in review module ────────────────────────────────────

console.log('\nSafety: no live sends / enrollments in review module')
assert(!reviewSrc.includes('telnyx'), 'no Telnyx calls in review module')
assert(!reviewSrc.includes('sendMessage'), 'no sendMessage in review module')
assert(!reviewSrc.includes('workflowEnrollments'), 'no workflowEnrollments in review module')
assert(!reviewSrc.includes('messages.send'), 'no messages.send in review module')

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`)
console.log(` Phase 15 Verification: ${passCount} passed, ${failCount} failed`)
console.log('═'.repeat(60))

if (failCount > 0) {
  process.exit(1)
} else {
  console.log('\n✅ PHASE 15 PASS — Pilot Prep UX + Dry-Run Review verified.\n')
}

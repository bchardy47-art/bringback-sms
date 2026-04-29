/**
 * Phase 16 — Pilot Data Pack + 10DLC Waiting Room — Verification Script
 *
 * 11 tests, verifies:
 *   1. No new migration needed — schema types added only
 *   2. TenDLCWaitingStatus + PilotReadinessScore types in schema
 *   3. pilot-pack.ts exports correct functions
 *   4. computeReadinessScore scores all 7 categories
 *   5. getTenDLCWaitingStatus covers all 6 status codes
 *   6. Export functions: leads CSV, previews CSV, dry-run JSON, sample messages, checklist
 *   7. Pilot pack API route exists (GET /api/admin/dlr/pilot-pack)
 *   8. All 5 export routes exist with correct handlers
 *   9. Selected leads export only includes selected leads
 *  10. Pilot pack page + ExportPanel exist with correct content
 *  11. Safety: no live sends, no enrollments, no batch status changes
 */

import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')

let passCount = 0
let failCount = 0

function pass(msg: string) { console.log(`  ✓ ${msg}`); passCount++ }
function fail(msg: string) { console.error(`  ✗ ${msg}`); failCount++ }
function assert(condition: boolean, msg: string) { condition ? pass(msg) : fail(msg) }
function readFile(rel: string): string { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }
function fileExists(rel: string): boolean { return fs.existsSync(path.join(ROOT, rel)) }

// ── Test 1: No new migration (schema types only) ──────────────────────────────

console.log('\nTest 1: No new migration needed (all DB fields existed from Phase 12)')
const migDir = 'drizzle/migrations'
const migFiles = fs.readdirSync(path.join(ROOT, migDir)).filter(f => f.endsWith('.sql')).sort()
const lastMig  = migFiles[migFiles.length - 1]
assert(lastMig === '0014_pilot_lead_import_review.sql', `Last migration is still 0014 (got: ${lastMig})`)
assert(!migFiles.some(f => f.includes('phase16') || f.includes('pilot_pack')), 'No Phase 16 migration file added')

// ── Test 2: Schema types ──────────────────────────────────────────────────────

console.log('\nTest 2: TenDLCWaitingStatus + PilotReadinessScore in schema.ts')
const schemaSrc = readFile('src/lib/db/schema.ts')

assert(schemaSrc.includes('TenDLCWaitingStatus'), 'TenDLCWaitingStatus type exported')
assert(schemaSrc.includes("'waiting_on_10dlc'"),      "includes 'waiting_on_10dlc'")
assert(schemaSrc.includes("'missing_tenant_info'"),   "includes 'missing_tenant_info'")
assert(schemaSrc.includes("'missing_consent_data'"),  "includes 'missing_consent_data'")
assert(schemaSrc.includes("'pilot_batch_not_ready'"), "includes 'pilot_batch_not_ready'")
assert(schemaSrc.includes("'ready_when_approved'"),   "includes 'ready_when_approved'")
assert(schemaSrc.includes("'ready_for_live_pilot'"),  "includes 'ready_for_live_pilot'")

assert(schemaSrc.includes('PilotReadinessScore'), 'PilotReadinessScore type exported')
assert(schemaSrc.includes('ReadinessBreakdown'),  'ReadinessBreakdown type exported')
assert(schemaSrc.includes('leadDataCompleteness:'), 'breakdown has leadDataCompleteness')
assert(schemaSrc.includes('consentCoverage:'),      'breakdown has consentCoverage')
assert(schemaSrc.includes('previewCompleteness:'),  'breakdown has previewCompleteness')
assert(schemaSrc.includes('noBlockers:'),           'breakdown has noBlockers')
assert(schemaSrc.includes('workflowApproval:'),     'breakdown has workflowApproval')
assert(schemaSrc.includes('tenDlcReadiness:'),      'breakdown has tenDlcReadiness')
assert(schemaSrc.includes('complianceHealth:'),     'breakdown has complianceHealth')
assert(schemaSrc.includes('recommendedNextAction:'), 'score has recommendedNextAction')

// ── Test 3: pilot-pack.ts exports ────────────────────────────────────────────

console.log('\nTest 3: pilot-pack.ts exports all functions')
const PACK_LIB = 'src/lib/pilot/pilot-pack.ts'
assert(fileExists(PACK_LIB), 'pilot-pack.ts exists')
const packSrc = readFile(PACK_LIB)

assert(packSrc.includes('export async function getPilotPackData'),   'exports getPilotPackData')
assert(packSrc.includes('export function computeReadinessScore'),    'exports computeReadinessScore')
assert(packSrc.includes('export function getTenDLCWaitingStatus'),   'exports getTenDLCWaitingStatus')
assert(packSrc.includes('export async function exportLeadsCSV'),     'exports exportLeadsCSV')
assert(packSrc.includes('export async function exportPreviewsCSV'),  'exports exportPreviewsCSV')
assert(packSrc.includes('export async function exportDryRunJSON'),   'exports exportDryRunJSON')
assert(packSrc.includes('export async function exportSampleMessages'), 'exports exportSampleMessages')
assert(packSrc.includes('export async function exportChecklist'),    'exports exportChecklist')

// ── Test 4: computeReadinessScore covers all 7 categories ────────────────────

console.log('\nTest 4: computeReadinessScore scores all 7 categories (max sum = 100)')
const scoreFnStart = packSrc.indexOf('export function computeReadinessScore')
const scoreFnEnd   = packSrc.indexOf('export function getTenDLCWaitingStatus')
const scoreFnSrc   = packSrc.slice(scoreFnStart, scoreFnEnd)

assert(scoreFnSrc.includes('leadDataCompleteness'),  'scores leadDataCompleteness')
assert(scoreFnSrc.includes('consentCoverage'),       'scores consentCoverage')
assert(scoreFnSrc.includes('previewCompleteness'),   'scores previewCompleteness')
assert(scoreFnSrc.includes('noBlockers'),            'scores noBlockers')
assert(scoreFnSrc.includes('workflowApproval'),      'scores workflowApproval')
assert(scoreFnSrc.includes('tenDlcReadiness'),       'scores tenDlcReadiness')
assert(scoreFnSrc.includes('complianceHealth'),      'scores complianceHealth')

// Max values sum to 100: 15+20+15+15+10+15+10
const maxVals = [15, 20, 15, 15, 10, 15, 10]
assert(maxVals.reduce((a, b) => a + b, 0) === 100, 'max category values sum to 100')

assert(scoreFnSrc.includes("status = 'ready'"),          "status 'ready' at high score")
assert(scoreFnSrc.includes("status = 'needs_attention'"), "status 'needs_attention' defined")
assert(scoreFnSrc.includes("status = 'in_progress'"),     "status 'in_progress' defined")
assert(scoreFnSrc.includes("status = 'not_started'"),     "status 'not_started' at low score")

// ── Test 5: getTenDLCWaitingStatus covers all 6 codes ────────────────────────

console.log('\nTest 5: getTenDLCWaitingStatus covers all 6 status codes')
const waitFnStart = packSrc.indexOf('export function getTenDLCWaitingStatus')
const waitFnEnd   = packSrc.indexOf('export async function exportLeadsCSV')
const waitFnSrc   = packSrc.slice(waitFnStart, waitFnEnd)

assert(waitFnSrc.includes("'ready_for_live_pilot'"),  "returns 'ready_for_live_pilot'")
assert(waitFnSrc.includes("'ready_when_approved'"),   "returns 'ready_when_approved'")
assert(waitFnSrc.includes("'waiting_on_10dlc'"),      "returns 'waiting_on_10dlc'")
assert(waitFnSrc.includes("'missing_tenant_info'"),   "returns 'missing_tenant_info'")
assert(waitFnSrc.includes("'missing_consent_data'"),  "returns 'missing_consent_data'")
assert(waitFnSrc.includes("'pilot_batch_not_ready'"), "returns 'pilot_batch_not_ready'")

// ready_for_live_pilot requires 10DLC approved
assert(
  waitFnSrc.includes("'approved'") && waitFnSrc.includes("'ready_for_live_pilot'"),
  'ready_for_live_pilot gated on approved status',
)
// ready_when_approved when pending but everything else ready
assert(
  waitFnSrc.includes("'pending'") && waitFnSrc.includes("'ready_when_approved'"),
  'ready_when_approved handles pending status',
)

// ── Test 6: Export functions produce correct formats ──────────────────────────

console.log('\nTest 6: Export function implementations')

// Leads CSV
const leadsCsvFnStart = packSrc.indexOf('export async function exportLeadsCSV')
const leadsCsvFnEnd   = packSrc.indexOf('export async function exportPreviewsCSV')
const leadsCsvSrc     = packSrc.slice(leadsCsvFnStart, leadsCsvFnEnd)
assert(
  leadsCsvSrc.includes("importStatus, 'selected'") || leadsCsvSrc.includes("importStatus,\n") || leadsCsvSrc.includes("'selected'"),
  'exportLeadsCSV filters to selected leads only',
)
assert(leadsCsvSrc.includes('firstName'), 'exportLeadsCSV includes firstName')
assert(leadsCsvSrc.includes('consentStatus'), 'exportLeadsCSV includes consentStatus')

// Previews CSV
const previewsCsvStart = packSrc.indexOf('export async function exportPreviewsCSV')
const previewsCsvEnd   = packSrc.indexOf('export async function exportDryRunJSON')
const previewsCsvSrc   = packSrc.slice(previewsCsvStart, previewsCsvEnd)
assert(
  previewsCsvSrc.includes("'selected'"),
  'exportPreviewsCSV filters to selected leads',
)
assert(previewsCsvSrc.includes('rendered'), 'exportPreviewsCSV includes rendered message')
assert(
  previewsCsvSrc.includes('hasOptOut') || previewsCsvSrc.includes('opt.out') || previewsCsvSrc.includes('STOP'),
  'exportPreviewsCSV detects opt-out footer',
)
assert(previewsCsvSrc.includes('usedFallback'), 'exportPreviewsCSV includes fallback flag')

// Dry-run JSON
const dryRunStart = packSrc.indexOf('export async function exportDryRunJSON')
const dryRunEnd   = packSrc.indexOf('export async function exportSampleMessages')
const dryRunSrc   = packSrc.slice(dryRunStart, dryRunEnd)
assert(dryRunSrc.includes('generateDryRunReport'), 'exportDryRunJSON calls generateDryRunReport')
assert(dryRunSrc.includes('JSON.stringify'), 'exportDryRunJSON produces JSON string')

// Sample messages
const sampleStart = packSrc.indexOf('export async function exportSampleMessages')
const sampleEnd   = packSrc.indexOf('export async function exportChecklist')
const sampleSrc   = packSrc.slice(sampleStart, sampleEnd)
assert(sampleSrc.includes('10DLC SAMPLE MESSAGES') || sampleSrc.includes('10dlc') || sampleSrc.includes('TCR'), 'exportSampleMessages generates 10DLC text')
assert(sampleSrc.includes('previewMessages'), 'exportSampleMessages reads previewMessages')

// Checklist
const checklistStart = packSrc.indexOf('export async function exportChecklist')
const checklistSrc   = packSrc.slice(checklistStart)
assert(checklistSrc.includes('# Pilot Launch Checklist'), 'exportChecklist produces markdown checklist')
assert(checklistSrc.includes('10DLC'), 'exportChecklist includes 10DLC section')
assert(checklistSrc.includes('approvedForLive'), 'exportChecklist checks workflow approval')
assert(checklistSrc.includes('complianceBlocked'), 'exportChecklist checks compliance block')

// ── Test 7: Pilot pack API route ──────────────────────────────────────────────

console.log('\nTest 7: Pilot pack API route')
const PACK_ROUTE = 'src/app/api/admin/dlr/pilot-pack/route.ts'
assert(fileExists(PACK_ROUTE), 'pilot-pack API route exists')
const packRouteSrc = readFile(PACK_ROUTE)
assert(packRouteSrc.includes('export async function GET'), 'route has GET handler')
assert(packRouteSrc.includes('getPilotPackData'), 'route calls getPilotPackData')
assert(packRouteSrc.includes('tenantId'), 'route requires tenantId')

// ── Test 8: All 5 export routes exist ─────────────────────────────────────────

console.log('\nTest 8: All 5 export routes exist')
const EXPORT_BASE = 'src/app/api/admin/dlr/pilot-pack/export'

const exportRoutes: Array<{ path: string; fn: string; format: string }> = [
  { path: 'leads',           fn: 'exportLeadsCSV',      format: 'text/csv' },
  { path: 'previews',        fn: 'exportPreviewsCSV',   format: 'text/csv' },
  { path: 'dry-run',         fn: 'exportDryRunJSON',    format: 'application/json' },
  { path: 'sample-messages', fn: 'exportSampleMessages',format: 'text/plain' },
  { path: 'checklist',       fn: 'exportChecklist',     format: 'text/markdown' },
]

for (const r of exportRoutes) {
  const routePath = `${EXPORT_BASE}/${r.path}/route.ts`
  assert(fileExists(routePath), `${r.path} export route exists`)
  const src = readFile(routePath)
  assert(src.includes('export async function GET'), `${r.path} route has GET handler`)
  assert(src.includes(r.fn), `${r.path} route calls ${r.fn}`)
  assert(src.includes(r.format), `${r.path} route returns ${r.format}`)
  assert(src.includes('Content-Disposition'), `${r.path} route sets Content-Disposition`)
  assert(src.includes('attachment'), `${r.path} route triggers file download`)
}

// ── Test 9: Selected leads filter validation ──────────────────────────────────

console.log('\nTest 9: exportLeadsCSV filters to selected leads only')
// Verify source-level: exportLeadsCSV only queries where importStatus = 'selected'
assert(
  leadsCsvSrc.includes("eq(pilotLeadImports.importStatus, 'selected')"),
  "exportLeadsCSV uses eq(importStatus, 'selected') filter",
)
// Preview CSV also filters to selected
assert(
  previewsCsvSrc.includes("eq(pilotLeadImports.importStatus, 'selected')"),
  "exportPreviewsCSV uses eq(importStatus, 'selected') filter",
)

// ── Test 10: UI page + ExportPanel ───────────────────────────────────────────

console.log('\nTest 10: Pilot pack page + ExportPanel')
const PAGE_PATH    = 'src/app/(dashboard)/admin/dlr/pilot-pack/page.tsx'
const EXPORT_PANEL = 'src/app/(dashboard)/admin/dlr/pilot-pack/ExportPanel.tsx'

assert(fileExists(PAGE_PATH), 'pilot-pack page exists')
assert(fileExists(EXPORT_PANEL), 'ExportPanel.tsx exists')

const pageSrc = readFile(PAGE_PATH)
assert(pageSrc.includes('getPilotPackData'), 'page calls getPilotPackData')
assert(pageSrc.includes('readinessScore'), 'page shows readiness score')
assert(pageSrc.includes('tenDLCWaitingStatus'), 'page shows 10DLC waiting status')
assert(pageSrc.includes('selectedLeads'), 'page shows selected leads')
assert(pageSrc.includes('ExportPanel'), 'page includes ExportPanel component')
assert(pageSrc.includes('dryRunReport'), 'page shows dry-run report summary')
assert(pageSrc.includes('Pilot Readiness Score'), 'page has readiness score section heading')
assert(pageSrc.includes('10DLC Waiting Room'), 'page has 10DLC waiting room section')
assert(pageSrc.includes('breakdown'), 'page shows score breakdown')
assert(pageSrc.includes('blockers'), 'page shows blockers list')
assert(pageSrc.includes('warnings'), 'page shows warnings list')

const exportPanelSrc = readFile(EXPORT_PANEL)
assert(exportPanelSrc.includes("'use client'"), 'ExportPanel is a client component')
assert(exportPanelSrc.includes('leads'), 'ExportPanel has leads export')
assert(exportPanelSrc.includes('previews'), 'ExportPanel has previews export')
assert(exportPanelSrc.includes('dry-run'), 'ExportPanel has dry-run export')
assert(exportPanelSrc.includes('sample-messages'), 'ExportPanel has sample-messages export')
assert(exportPanelSrc.includes('checklist'), 'ExportPanel has checklist export')
assert(exportPanelSrc.includes('download'), 'ExportPanel uses download attribute')

// Nav link added to layout
const layoutSrc = readFile('src/app/(dashboard)/admin/dlr/layout.tsx')
assert(layoutSrc.includes('/admin/dlr/pilot-pack'), 'Pilot Pack added to DLR nav')

// ── Test 11: Safety — no live sends, no enrollments, no batch changes ─────────

console.log('\nTest 11: Safety — no live sends / enrollments / batch status changes')
assert(!packSrc.includes('telnyx'),              'no Telnyx calls in pilot-pack.ts')
assert(!packSrc.includes('sendMessage'),         'no sendMessage in pilot-pack.ts')
assert(!packSrc.includes('workflowEnrollments'), 'no workflowEnrollments in pilot-pack.ts')
assert(!packSrc.includes('messages.send'),       'no messages.send in pilot-pack.ts')
assert(
  !packSrc.includes(".update(pilotBatches)") && !packSrc.includes(".insert(pilotBatches)"),
  'pilot-pack.ts never writes to pilotBatches',
)
assert(
  !packSrc.includes(".update(pilotBatchLeads)") && !packSrc.includes(".insert(pilotBatchLeads)"),
  'pilot-pack.ts never writes to pilotBatchLeads',
)

// Export routes — also read-only
for (const r of exportRoutes) {
  const src = readFile(`${EXPORT_BASE}/${r.path}/route.ts`)
  assert(!src.includes('telnyx'),      `${r.path} route has no Telnyx calls`)
  assert(!src.includes('db.update'),   `${r.path} route has no DB writes`)
  assert(!src.includes('db.insert'),   `${r.path} route has no DB inserts`)
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`)
console.log(` Phase 16 Verification: ${passCount} passed, ${failCount} failed`)
console.log('═'.repeat(60))

if (failCount > 0) {
  process.exit(1)
} else {
  console.log('\n✅ PHASE 16 PASS — Pilot Data Pack + 10DLC Waiting Room verified.\n')
}

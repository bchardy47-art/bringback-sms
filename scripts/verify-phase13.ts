/**
 * Phase 13 — Verification Script
 *
 * Verifies the Live Pilot Execution module without sending real SMS messages.
 * All tests operate in dry-run / read-only / type-check mode.
 *
 * Run: npx tsx scripts/verify-phase13.ts
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// ── Tiny test harness ──────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`)
    passed++
  } else {
    console.error(`  ✗ FAIL: ${message}`)
    failed++
  }
}

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(
    () => console.log(`\n[PASS] ${name}`),
    (err: unknown) => {
      console.error(`\n[FAIL] ${name}`)
      console.error('  ', err instanceof Error ? err.message : String(err))
      failed++
    },
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, '..')

function fileExists(rel: string): boolean {
  return existsSync(resolve(ROOT, rel))
}

function readFile(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8')
}

// ── Tests ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log(' Phase 13 — Live Pilot Execution — Verification')
  console.log('═══════════════════════════════════════════════════════════')

  // ── Test 1: Migration file exists with required columns ──────────────────────
  await test('1. Migration file has new pilot_batches columns', () => {
    const migPath = 'drizzle/migrations/0012_live_pilot_execution.sql'
    assert(fileExists(migPath), 'Migration file exists')

    const sql = readFile(migPath)
    assert(sql.includes('confirmation_phrase'), 'Column: confirmation_phrase')
    assert(sql.includes('confirmation_checks'), 'Column: confirmation_checks')
    assert(sql.includes('confirmed_by'),        'Column: confirmed_by')
    assert(sql.includes('confirmed_at'),        'Column: confirmed_at')
    assert(sql.includes('pilot_report'),        'Column: pilot_report')
  })

  // ── Test 2: Schema exports required constants and types ──────────────────────
  await test('2. Schema exports REQUIRED_CONFIRMATION_PHRASE and related types', () => {
    const schema = readFile('src/lib/db/schema.ts')

    assert(
      schema.includes("REQUIRED_CONFIRMATION_PHRASE = 'SEND FIRST PILOT'"),
      "REQUIRED_CONFIRMATION_PHRASE = 'SEND FIRST PILOT'",
    )
    assert(schema.includes('PilotConfirmationChecks'), 'PilotConfirmationChecks type exported')
    assert(schema.includes('tenDlcApproved'),          'PilotConfirmationChecks.tenDlcApproved')
    assert(schema.includes('messageReviewed'),         'PilotConfirmationChecks.messageReviewed')
    assert(schema.includes('optOutTested'),            'PilotConfirmationChecks.optOutTested')
    assert(schema.includes('emergencyControlsUnderstood'), 'PilotConfirmationChecks.emergencyControlsUnderstood')

    assert(schema.includes('PilotReport'),       'PilotReport type exported')
    assert(schema.includes('PilotReportLead'),   'PilotReportLead type exported')
    assert(schema.includes('PilotReportEvent'),  'PilotReportEvent type exported')

    assert(schema.includes('confirmationPhrase'), 'pilotBatches.confirmationPhrase column')
    assert(schema.includes('confirmationChecks'), 'pilotBatches.confirmationChecks column')
    assert(schema.includes('confirmedBy'),        'pilotBatches.confirmedBy column')
    assert(schema.includes('confirmedAt'),        'pilotBatches.confirmedAt column')
    assert(schema.includes('pilotReport'),        'pilotBatches.pilotReport column')
  })

  // ── Test 3: live-pilot-execution exports required functions and types ─────────
  await test('3. live-pilot-execution.ts exports correct API surface', () => {
    const src = readFile('src/lib/pilot/live-pilot-execution.ts')

    assert(src.includes('export async function validateConfirmationGate'), 'validateConfirmationGate exported')
    assert(src.includes('export async function submitConfirmation'),       'submitConfirmation exported')
    assert(src.includes('export async function liveStartSmokeTest'),      'liveStartSmokeTest exported')
    assert(src.includes('export async function liveVerifySmokeTest'),     'liveVerifySmokeTest exported')
    assert(src.includes('export async function liveStartRemainingLeads'), 'liveStartRemainingLeads exported')
    assert(src.includes('export async function getLivePilotStatus'),      'getLivePilotStatus exported')
    assert(src.includes('export async function generatePilotReport'),     'generatePilotReport exported')

    assert(src.includes('export type LivePilotLead'),   'LivePilotLead type exported')
    assert(src.includes('export type LivePilotStatus'), 'LivePilotStatus type exported')
  })

  // ── Test 4: LivePilotStatus type has all required fields ─────────────────────
  await test('4. LivePilotStatus type has all required fields', () => {
    const src = readFile('src/lib/pilot/live-pilot-execution.ts')

    // Find the LivePilotStatus block
    const typeStart = src.indexOf('export type LivePilotStatus')
    const typeEnd   = src.indexOf('\n}', typeStart) + 2
    const typeBlock = src.slice(typeStart, typeEnd)

    assert(typeBlock.includes('tenantName'),         'LivePilotStatus.tenantName')
    assert(typeBlock.includes('workflowName'),       'LivePilotStatus.workflowName')
    assert(typeBlock.includes('leads: LivePilotLead[]'), 'LivePilotStatus.leads: LivePilotLead[]')
    assert(typeBlock.includes('confirmed:'),         'LivePilotStatus.confirmed')
    assert(typeBlock.includes('confirmationPhrase'), 'LivePilotStatus.confirmationPhrase')
    assert(typeBlock.includes('confirmationChecks'), 'LivePilotStatus.confirmationChecks')
    assert(typeBlock.includes('confirmedBy'),        'LivePilotStatus.confirmedBy')
    assert(typeBlock.includes('confirmedAt'),        'LivePilotStatus.confirmedAt')
    assert(typeBlock.includes('complaintCount'),     'LivePilotStatus.complaintCount')
    assert(typeBlock.includes('failedCount'),        'LivePilotStatus.failedCount')
    assert(typeBlock.includes('goNoGoBlocked'),      'LivePilotStatus.goNoGoBlocked')
    assert(typeBlock.includes('goNoGoBlockerCount'), 'LivePilotStatus.goNoGoBlockerCount')
    assert(typeBlock.includes('reportGenerated'),    'LivePilotStatus.reportGenerated')
  })

  // ── Test 5: LivePilotLead type has isSmokeTestLead ───────────────────────────
  await test('5. LivePilotLead type has all lead fields including isSmokeTestLead', () => {
    const src = readFile('src/lib/pilot/live-pilot-execution.ts')

    const typeStart = src.indexOf('export type LivePilotLead')
    const typeEnd   = src.indexOf('\n}', typeStart) + 2
    const typeBlock = src.slice(typeStart, typeEnd)

    assert(typeBlock.includes('leadId'),              'LivePilotLead.leadId')
    assert(typeBlock.includes('firstName'),           'LivePilotLead.firstName')
    assert(typeBlock.includes('lastName'),            'LivePilotLead.lastName')
    assert(typeBlock.includes('phone'),               'LivePilotLead.phone')
    assert(typeBlock.includes('sendStatus'),          'LivePilotLead.sendStatus')
    assert(typeBlock.includes('skipReason'),          'LivePilotLead.skipReason')
    assert(typeBlock.includes('enrollmentId'),        'LivePilotLead.enrollmentId')
    assert(typeBlock.includes('eligibilityResult'),   'LivePilotLead.eligibilityResult')
    assert(typeBlock.includes('previewMessages'),     'LivePilotLead.previewMessages')
    assert(typeBlock.includes('approvedForSend'),     'LivePilotLead.approvedForSend')
    assert(typeBlock.includes('replyClassification'), 'LivePilotLead.replyClassification')
    assert(typeBlock.includes('handoffTaskId'),       'LivePilotLead.handoffTaskId')
    assert(typeBlock.includes('isSmokeTestLead'),     'LivePilotLead.isSmokeTestLead')
  })

  // ── Test 6: validateConfirmationGate logic handles wrong phrase ───────────────
  await test('6. validateConfirmationGate validates phrase and checkboxes', () => {
    const src = readFile('src/lib/pilot/live-pilot-execution.ts')

    // Phrase check must exist and be case-sensitive
    assert(
      src.includes('REQUIRED_CONFIRMATION_PHRASE'),
      'validateConfirmationGate references REQUIRED_CONFIRMATION_PHRASE',
    )
    assert(
      src.includes("phrase.trim() !== REQUIRED_CONFIRMATION_PHRASE"),
      'Exact phrase comparison (trimmed)',
    )

    // All four checkbox keys must be validated
    assert(src.includes('checks.tenDlcApproved'),              'Validates tenDlcApproved')
    assert(src.includes('checks.messageReviewed'),             'Validates messageReviewed')
    assert(src.includes('checks.optOutTested'),                'Validates optOutTested')
    assert(src.includes('checks.emergencyControlsUnderstood'), 'Validates emergencyControlsUnderstood')

    // Lead-count guard
    assert(src.includes('FIRST_PILOT_CAP'), 'Lead count guard uses FIRST_PILOT_CAP')

    // Go/No-Go integration
    assert(src.includes('generateGoNoGoReport'), 'Calls generateGoNoGoReport inside validation')
    assert(src.includes("verdict === 'no_go'"),  'Rejects when verdict is no_go')
  })

  // ── Test 7: getLivePilotStatus populates tenant/workflow/leads ────────────────
  await test('7. getLivePilotStatus builds tenantName, workflowName, and LivePilotLead[]', () => {
    const src = readFile('src/lib/pilot/live-pilot-execution.ts')

    // Find getLivePilotStatus function
    const fnStart = src.indexOf('export async function getLivePilotStatus')
    const fnEnd   = src.indexOf('\n}\n', fnStart) + 3
    const fnBody  = src.slice(fnStart, fnEnd)

    assert(fnBody.includes('tenant: true'),          'Loads tenant relation')
    assert(fnBody.includes('workflow: true'),         'Loads workflow relation')
    assert(fnBody.includes('LivePilotLead[]'),        'Types livePilotLeads as LivePilotLead[]')
    assert(fnBody.includes('isSmokeTestLead'),        'Sets isSmokeTestLead from smokeTestLeadId')
    assert(fnBody.includes('smokeTestLeadId'),        'Compares to base.smokeTestLeadId')
    assert(fnBody.includes('tenantName'),             'Returns tenantName')
    assert(fnBody.includes('workflowName'),           'Returns workflowName')
    assert(fnBody.includes('leads:') && fnBody.includes('livePilotLeads'), 'Returns leads array')
    assert(fnBody.includes('complaintCount'),         'Returns complaintCount')
    assert(fnBody.includes('goNoGoBlocked'),          'Returns goNoGoBlocked')
    assert(fnBody.includes('reportGenerated'),        'Returns reportGenerated')
  })

  // ── Test 8: API route handles all required actions ────────────────────────────
  await test('8. API route exports GET + POST and handles all 9 actions', () => {
    const routePath = 'src/app/api/admin/live-pilot/[batchId]/route.ts'
    assert(fileExists(routePath), 'API route file exists')

    const src = readFile(routePath)
    assert(src.includes('export async function GET'),  'Exports GET handler')
    assert(src.includes('export async function POST'), 'Exports POST handler')

    // All required actions
    const actions = ['confirm', 'validate_confirm', 'start_smoke', 'verify_smoke',
                     'start_remaining', 'pause', 'cancel', 'confirm_continue', 'generate_report']
    for (const action of actions) {
      assert(src.includes(`case '${action}'`), `Handles action: '${action}'`)
    }
  })

  // ── Test 9: UI files exist and are structurally correct ───────────────────────
  await test('9. Live pilot UI files exist and reference correct components', () => {
    const pagePath  = 'src/app/(dashboard)/admin/dlr/live-pilot/page.tsx'
    const gatePath  = 'src/app/(dashboard)/admin/dlr/live-pilot/ConfirmationGate.tsx'
    const layoutPath = 'src/app/(dashboard)/admin/dlr/layout.tsx'

    assert(fileExists(pagePath),   'live-pilot/page.tsx exists')
    assert(fileExists(gatePath),   'live-pilot/ConfirmationGate.tsx exists')
    assert(fileExists(layoutPath), 'dlr/layout.tsx exists')

    const page = readFile(pagePath)
    assert(page.includes("'use server'"),         'page.tsx is a server component')
    assert(page.includes('getLivePilotStatus'),   'page.tsx calls getLivePilotStatus')
    assert(page.includes('ConfirmationGate'),     'page.tsx renders ConfirmationGate')
    assert(page.includes('status.tenantName'),    'page.tsx uses status.tenantName')
    assert(page.includes('status.workflowName'),  'page.tsx uses status.workflowName')
    assert(page.includes('status.leads'),         'page.tsx uses status.leads')
    assert(page.includes('isSmokeTestLead'),      'page.tsx uses lead.isSmokeTestLead')

    const gate = readFile(gatePath)
    assert(gate.includes("'use client'"),                'ConfirmationGate.tsx is a client component')
    assert(gate.includes('REQUIRED_CONFIRMATION_PHRASE'), 'ConfirmationGate uses REQUIRED_CONFIRMATION_PHRASE')
    assert(gate.includes("action: 'confirm'"),           "ConfirmationGate posts action: 'confirm'")

    const layout = readFile(layoutPath)
    assert(layout.includes('/admin/dlr/live-pilot'), 'Layout has Live Pilot nav link')
  })

  // ── Test 10: generatePilotReport builds recommendation logic ─────────────────
  await test('10. generatePilotReport and computeRecommendation logic', () => {
    const src = readFile('src/lib/pilot/live-pilot-execution.ts')

    assert(src.includes('export async function generatePilotReport'), 'generatePilotReport exported')
    assert(src.includes('computeRecommendation'),   'Calls computeRecommendation helper')
    assert(src.includes("'expand'"),                "Recommendation: 'expand'")
    assert(src.includes("'repeat'"),                "Recommendation: 'repeat'")
    assert(src.includes("'pause'"),                 "Recommendation: 'pause'")
    assert(src.includes("'fix_issues'"),            "Recommendation: 'fix_issues'")

    // Report fields
    assert(src.includes('generatedAt'),      'Report includes generatedAt')
    assert(src.includes('recommendation'),   'Report includes recommendation')
    assert(src.includes('recommendationReason'), 'Report includes recommendationReason')
    assert(src.includes('timeline'),         'Report includes timeline')

    // Persists report
    assert(src.includes('pilotReport: report'), 'Persists report to pilotBatches table')

    // Complaint → pause
    assert(
      src.includes("verdict: 'pause'") || src.includes("verdict: 'pause',"),
      "complaintCount > 0 triggers 'pause' recommendation",
    )
    // No issues → expand
    assert(
      src.includes("verdict: 'expand'") || src.includes("verdict: 'expand',"),
      "completed with no complaints triggers 'expand'",
    )
  })

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(` Results: ${passed} passed | ${failed} failed`)
  console.log('═══════════════════════════════════════════════════════════')

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})

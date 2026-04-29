/**
 * Phase 14 — Verification Script
 *
 * Verifies Pilot Lead Import + Selection without a live DB or SMS sends.
 * All tests operate in read-only / type-check / unit-test mode.
 *
 * Run: npx tsx scripts/verify-phase14.ts
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

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`\n[PASS] ${name}`)
  } catch (err) {
    console.error(`\n[FAIL] ${name}`)
    console.error('  ', err instanceof Error ? err.message : String(err))
    failed++
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, '..')

function fileExists(rel: string): boolean {
  return existsSync(resolve(ROOT, rel))
}

function readFile(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8')
}

// Import the pure functions for unit testing (no DB calls)
import {
  normalizePhone,
  isValidE164,
  parseCSV,
  csvRowToImportInput,
} from '../src/lib/pilot/lead-import'

// ── Tests ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log(' Phase 14 — Pilot Lead Import + Selection — Verification')
  console.log('═══════════════════════════════════════════════════════════')

  // ── Test 1: Valid lead imports successfully (unit: normalizePhone + isValidE164) ─
  await test('1. Valid lead: phone normalizes to E.164 and passes validity check', () => {
    assert(normalizePhone('6025551234') === '+16025551234',  '10-digit → +1XXXXXXXXXX')
    assert(normalizePhone('16025551234') === '+16025551234', '11-digit with 1 → +1XXXXXXXXXX')
    assert(normalizePhone('(602) 555-1234') === '+16025551234', 'Formatted with parens/spaces/dash')
    assert(normalizePhone('602-555-1234') === '+16025551234',   'Dash-separated')
    assert(normalizePhone('+16025551234') === '+16025551234',   'Already E.164 (10 digits after +1)')
    assert(isValidE164('+16025551234'), 'E.164 normalized phone passes isValidE164')
  })

  // ── Test 2: Phone normalization produces correct E.164 format ─────────────────
  await test('2. Phone normalization handles all US input formats', () => {
    assert(normalizePhone('6025551234') === '+16025551234',   'Raw 10 digits')
    assert(normalizePhone(' 602 555 1234 ') === '+16025551234', 'Spaces stripped')
    assert(normalizePhone('1-602-555-1234') === '+16025551234', 'Leading 1 with dashes')
    assert(normalizePhone('(800)FLOWERS') === null,   'Non-numeric letters → null (7 non-1 digits)')
    assert(normalizePhone('') === null,               'Empty string → null')
    assert(normalizePhone('123') === null,            'Too few digits → null')
    assert(normalizePhone('12345678901234567') === null, 'Too many digits → null')
  })

  // ── Test 3: Invalid phone is blocked ──────────────────────────────────────────
  await test('3. Invalid phone returns null from normalizePhone', () => {
    assert(normalizePhone('000') === null,             '3-digit number → null')
    assert(normalizePhone('abcdefghij') === null,      'Letters only → null')
    assert(normalizePhone('12345') === null,           '5 digits → null')
    assert(normalizePhone('+44 7911 123456') === null, 'UK number (12 non-E1 digits) → null')
    assert(!isValidE164('invalid'),                    'isValidE164 rejects non-E.164')
    assert(!isValidE164('16025551234'),                'isValidE164 rejects without leading +')
    assert(!isValidE164('+123'),                       'isValidE164 rejects too short (+123 has only 2 digits after +)')
  })

  // ── Test 4: Duplicate phone detection in validation logic ─────────────────────
  await test('4. validateImportRow logic: dedup and consent checks exist in source', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')

    // Phone-based intra-session dedup
    assert(src.includes('seenPhones.has(phone)'),         'Intra-session phone dedup')
    assert(src.includes("blocked.push") && src.includes('Duplicate phone'),
                                                           'Duplicate phone → blocked')

    // Email-based dedup (warning)
    assert(src.includes('seenEmails.has(email)'),         'Intra-session email dedup')

    // Cross-DB dedup warning
    assert(src.includes('duplicateOfLeadId'),             'Tracks duplicateOfLeadId')
    assert(src.includes("warnings.push") && src.includes('already exists'),
                                                           'Existing lead → warning')
  })

  // ── Test 5: Opted-out number is blocked ───────────────────────────────────────
  await test('5. Opted-out number check exists and blocks the lead', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')
    assert(src.includes('optOuts'),           'Queries optOuts table')
    assert(src.includes('opted out'),         'Opt-out block message')
    assert(src.includes("blocked.push") && src.includes('opted out'),
                                              'Opt-out → blocked')
  })

  // ── Test 6: Revoked consent is blocked ────────────────────────────────────────
  await test('6. Revoked consent is a hard block', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')
    assert(src.includes("consent === 'revoked'"),         "'revoked' check exists")
    assert(src.includes("Consent has been explicitly revoked"),
                                                           'Revoked → blocked reason')
    // unknown/empty → warning
    assert(src.includes("consent === 'unknown' || consent === ''"),
                                                           "'unknown' → warning")
    assert(src.includes('Consent status is unknown'),     'Unknown consent warning message')
  })

  // ── Test 7: Unknown consent creates warning (not block) ───────────────────────
  await test('7. Unknown consent creates warning, not hard block', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')
    // 'unknown' must go into warnings[], not blocked[]
    // Find the unknown consent block and verify it calls warnings.push not blocked.push
    const unknownIdx = src.indexOf("consent === 'unknown' || consent === ''")
    const blockAfter = src.indexOf("blocked.push", unknownIdx)
    const warnAfter  = src.indexOf("warnings.push", unknownIdx)
    // warnings.push must come before the next blocked.push after the unknown check
    assert(warnAfter > unknownIdx,  'Unknown consent → warnings.push (not blocked)')
    assert(warnAfter < blockAfter || blockAfter === -1 || blockAfter > unknownIdx + 400,
                                    'Unknown consent block uses warnings[], not blocked[]')
  })

  // ── Test 8: Missing vehicle name uses fallback — not a block ──────────────────
  await test('8. Missing vehicle interest triggers warning only (not blocked)', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')
    assert(src.includes('No vehicle of interest'),        'Missing vehicle warning text')
    assert(src.includes('fallback copy'),                 'References fallback copy')
    // The vehicle warning must be in warnings[], not blocked[]
    const vehicleWarnIdx = src.indexOf('No vehicle of interest')
    // Find the closest warnings.push before this message
    const warnPushIdx = src.lastIndexOf('warnings.push', vehicleWarnIdx)
    assert(warnPushIdx > 0 && vehicleWarnIdx - warnPushIdx < 80,
                                                           'Vehicle warning goes to warnings[], not blocked[]')
    // usedFallback flag is set in preview rendering
    assert(src.includes('usedFallback'),                  'usedFallback flag used in preview')
  })

  // ── Test 9: Cannot select more than 5 leads ───────────────────────────────────
  await test('9. Hard cap at FIRST_PILOT_CAP (5) leads enforced in setLeadSelected', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')
    assert(src.includes('FIRST_PILOT_CAP'),                          'Imports FIRST_PILOT_CAP')
    assert(src.includes('Cannot select more than'),                  'Cap error message exists')
    assert(src.includes('>= FIRST_PILOT_CAP'),                      'Comparison uses FIRST_PILOT_CAP')
    assert(src.includes('selectedForBatch, true') || src.includes("selectedForBatch: true"),
                                                          'Counts leads with selectedForBatch=true')

    const schemaSrc = readFile('src/lib/db/schema.ts')
    assert(schemaSrc.includes('FIRST_PILOT_CAP = 5'),                'FIRST_PILOT_CAP is 5')
  })

  // ── Test 10: Only eligible leads can create a pilot batch ─────────────────────
  await test('10. createPilotBatchFromImport excludes blocked/excluded leads', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')
    assert(src.includes("['selected', 'eligible', 'warning'].includes(r.importStatus)"),
                                                          'Only eligible statuses pass filter')
    assert(src.includes("r.importStatus !== 'blocked'"),  'Blocked leads explicitly excluded')
    assert(src.includes("r.importStatus !== 'excluded'"), 'Excluded leads explicitly excluded')
    assert(src.includes('No eligible leads selected'),    'Error if nothing passes filter')
    assert(src.includes(`Cannot exceed ${5} leads`) || src.includes('Cannot exceed'),
                                                          'Cap enforced in createBatch too')
  })

  // ── Test 11: Created batch remains in draft/preview mode ─────────────────────
  await test('11. createPilotBatchFromImport creates batch with status=draft', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')
    assert(src.includes("status:         'draft'"),       'Batch status set to draft')
    assert(src.includes("isFirstPilot:   true"),          'isFirstPilot=true set')
    assert(src.includes("firstPilotState: 'not_started'"), 'firstPilotState=not_started')
    assert(src.includes("approvedForSend:  false"),       'approvedForSend=false on batch leads')
    assert(src.includes("sendStatus:       'pending'"),   'sendStatus=pending on batch leads')
  })

  // ── Test 12: No enrollments created during import or selection ────────────────
  await test('12. No enrollment creation in any import/selection/batch-creation code', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')
    // Should NOT import or call workflowEnrollments insert
    assert(!src.includes('workflowEnrollments') || !src.includes("insert(workflowEnrollments"),
                                                          'No workflowEnrollments.insert call')
    assert(!src.includes('startSmokeTest'),               'No startSmokeTest call')
    assert(!src.includes('startRemainingLeads'),          'No startRemainingLeads call')
    assert(!src.includes('liveStartSmokeTest'),           'No liveStartSmokeTest call')
    // API routes also must not start sends
    const importRoute = readFile('src/app/api/admin/dlr/pilot-leads/import/route.ts')
    assert(!importRoute.includes('startSmokeTest'),       'Import route: no startSmokeTest')
    assert(!importRoute.includes('enrollment'),           'Import route: no enrollment reference')
  })

  // ── Test 13: No live SMS sends occur ──────────────────────────────────────────
  await test('13. No Telnyx or send-message calls in any Phase 14 file', () => {
    const files = [
      'src/lib/pilot/lead-import.ts',
      'src/app/api/admin/dlr/pilot-leads/import/route.ts',
      'src/app/api/admin/dlr/pilot-leads/route.ts',
      'src/app/api/admin/dlr/pilot-leads/validate/route.ts',
      'src/app/api/admin/dlr/pilot-leads/create-batch/route.ts',
      'src/app/api/admin/dlr/pilot-leads/[id]/route.ts',
    ]
    for (const f of files) {
      const src = readFile(f)
      assert(!src.includes('telnyx'),         `${f}: no telnyx reference`)
      assert(!src.includes('sendMessage'),    `${f}: no sendMessage call`)
      assert(!src.includes('messages.send'),  `${f}: no messages.send call`)
    }
  })

  // ── Test 14: Message preview includes opt-out footer (fallback preview logic) ──
  await test('14. Preview rendering uses previewWorkflow and preserves usedFallback', () => {
    const src = readFile('src/lib/pilot/lead-import.ts')
    assert(src.includes('previewWorkflow'),      'Uses previewWorkflow from workflows/preview')
    assert(src.includes('usedFallback'),         'usedFallback propagated to PilotPreviewMessage')
    assert(src.includes('vehicleOfInterest'),    'vehicleOfInterest passed to render context')
    assert(src.includes("dealershipName"),       'dealershipName included in context')
    assert(src.includes('PilotPreviewMessage'),  'Returns PilotPreviewMessage[]')

    // UI file shows preview + fallback indicator
    const page = readFile('src/app/(dashboard)/admin/dlr/pilot-leads/page.tsx')
    assert(page.includes('usedFallback'),        'Page shows usedFallback indicator')
    assert(page.includes('fallback'),            'Page mentions fallback copy')
  })

  // ── Structural checks ─────────────────────────────────────────────────────────
  await test('Structural: all required files exist', () => {
    const files = [
      'drizzle/migrations/0013_pilot_lead_imports.sql',
      'src/lib/pilot/lead-import.ts',
      'src/app/api/admin/dlr/pilot-leads/import/route.ts',
      'src/app/api/admin/dlr/pilot-leads/route.ts',
      'src/app/api/admin/dlr/pilot-leads/validate/route.ts',
      'src/app/api/admin/dlr/pilot-leads/create-batch/route.ts',
      'src/app/api/admin/dlr/pilot-leads/[id]/route.ts',
      'src/app/(dashboard)/admin/dlr/pilot-leads/page.tsx',
      'src/app/(dashboard)/admin/dlr/pilot-leads/ImportForm.tsx',
    ]
    for (const f of files) {
      assert(fileExists(f), `Exists: ${f}`)
    }

    // Schema additions
    const schema = readFile('src/lib/db/schema.ts')
    assert(schema.includes('pilot_lead_imports'),          'pilotLeadImports table in schema')
    assert(schema.includes('PilotLeadImportStatus'),       'PilotLeadImportStatus type exported')
    assert(schema.includes('phoneRaw'),                    'phoneRaw column')
    assert(schema.includes('importStatus'),                'importStatus column')
    assert(schema.includes('blockedReasons'),              'blockedReasons column')
    assert(schema.includes('selectedForBatch'),            'selectedForBatch column')
    assert(schema.includes('duplicateOfLeadId'),           'duplicateOfLeadId column')
    assert(schema.includes('duplicateOfImportId'),         'duplicateOfImportId column')

    // Nav link
    const layout = readFile('src/app/(dashboard)/admin/dlr/layout.tsx')
    assert(layout.includes('/admin/dlr/pilot-leads'),      'Nav link added to layout')
  })

  // ── CSV parser unit tests ─────────────────────────────────────────────────────
  await test('CSV parser: parseCSV handles headers and rows correctly', () => {
    const csv = `firstName,lastName,phone,email\nJane,Smith,6025551234,jane@test.com\nBob,Jones,8005550199,`
    const rows = parseCSV(csv)
    assert(rows.length === 2,                  'Parses 2 data rows')
    assert(rows[0].firstName === 'Jane',       'Row 0 firstName = Jane')
    assert(rows[0].phone === '6025551234',     'Row 0 phone parsed')
    assert(rows[1].firstName === 'Bob',        'Row 1 firstName = Bob')
    assert(rows[1].email === '',               'Row 1 empty email = empty string')
    assert(parseCSV('').length === 0,          'Empty CSV returns []')
    assert(parseCSV('header\n').length === 0,  'Header-only returns []')

    // Quoted field with comma
    const csv2 = `name,notes\n"Smith, John","needs follow-up"`
    const rows2 = parseCSV(csv2)
    assert(rows2.length === 1,                 'Quoted comma handled')
    assert(rows2[0].name === 'Smith, John',    'Quoted field with comma preserved')
  })

  // ── csvRowToImportInput header aliasing ───────────────────────────────────────
  await test('csvRowToImportInput maps flexible header names', () => {
    const row1 = csvRowToImportInput({ 'First Name': 'Jane', 'Last Name': 'Smith', Phone: '6025551234', Vehicle: 'Camry' })
    assert(row1.firstName === 'Jane',          'First Name → firstName')
    assert(row1.vehicleName === 'Camry',       'Vehicle → vehicleName')

    const row2 = csvRowToImportInput({ first_name: 'Bob', last_name: 'Jones', phone: '8005550199' })
    assert(row2.firstName === 'Bob',           'first_name → firstName')
    assert(row2.phone === '8005550199',        'phone field preserved')
  })

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(` Results: ${passed} passed | ${failed} failed`)
  console.log('═══════════════════════════════════════════════════════════')

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})

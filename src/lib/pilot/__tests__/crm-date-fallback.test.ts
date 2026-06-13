/**
 * CRM date fallback tests — Phase 16 (smart date extraction)
 *
 * Pure-function tests for extractCrmDateWithSource, detectLeadSourceType,
 * and the updated classifyLeadAge missing-date message.
 * No DB, no Next.js — run with: npx tsx src/lib/pilot/__tests__/crm-date-fallback.test.ts
 */

import {
  extractCrmDateWithSource,
  detectLeadSourceType,
  classifyLeadAge,
  parseContactDate,
} from '../age-classification'

// ── minimal test harness ──────────────────────────────────────────────────────

let passed = 0
let failed = 0

function expect(description: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    console.log(`  ✓ ${description}`)
    passed++
  } else {
    console.error(`  ✗ ${description}`)
    console.error(`    expected: ${JSON.stringify(expected)}`)
    console.error(`    received: ${JSON.stringify(actual)}`)
    failed++
  }
}

function expectTruthy(description: string, actual: unknown) {
  if (actual) {
    console.log(`  ✓ ${description}`)
    passed++
  } else {
    console.error(`  ✗ ${description}`)
    console.error(`    expected truthy, got: ${JSON.stringify(actual)}`)
    failed++
  }
}

function expectNull(description: string, actual: unknown) {
  expect(description, actual, null)
}

// ── helpers ───────────────────────────────────────────────────────────────────

const DATE_60_DAYS_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const DATE_30_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

// ── tests: detectLeadSourceType ──────────────────────────────────────────────

console.log('\ndetectLeadSourceType')

expect('walk-in → lot',
  detectLeadSourceType({ lead_source: 'Walk-In' }), 'lot')

expect('showroom → lot',
  detectLeadSourceType({ source: 'Showroom' }), 'lot')

expect('service drive → lot',
  detectLeadSourceType({ leadSource: 'Service Drive' }), 'lot')

expect('floor → lot',
  detectLeadSourceType({ Lead_Source: 'Floor' } as Record<string, string>), 'unknown') // unknown: key not matched

expect('website → internet',
  detectLeadSourceType({ lead_source: 'Website' }), 'internet')

expect('autotrader → internet',
  detectLeadSourceType({ source: 'AutoTrader' }), 'internet')

expect('facebook → internet',
  detectLeadSourceType({ lead_source: 'facebook ads' }), 'internet')

expect('empty source → unknown',
  detectLeadSourceType({ lead_source: '' }), 'unknown')

expect('no source field → unknown',
  detectLeadSourceType({}), 'unknown')

expect('cargurus → internet',
  detectLeadSourceType({ lead_source: 'CarGurus' }), 'internet')

// ── tests: internet lead uses last_customer_reply_at before lead_created_at ──

console.log('\nextractCrmDateWithSource — internet lead priority')

const internetRow = {
  lead_source:             'Website',
  lead_created_at:         DATE_60_DAYS_AGO,
  last_customer_reply_at:  DATE_30_DAYS_AGO,
}

const internetResult = extractCrmDateWithSource(internetRow)
expect('internet: last_customer_reply_at beats lead_created_at',
  internetResult.matchedAlias, 'last_customer_reply_at')
expectTruthy('internet: date is parsed',
  internetResult.date)
expect('internet: sourceLabel is "Using last customer reply date"',
  internetResult.sourceLabel, 'Using last customer reply date')

// ── tests: walk-in lead uses lead_created_at first ────────────────────────────

console.log('\nextractCrmDateWithSource — lot lead priority')

const lotRow = {
  lead_source:             'Walk-In',
  lead_created_at:         DATE_60_DAYS_AGO,
  last_customer_reply_at:  DATE_30_DAYS_AGO,
}

const lotResult = extractCrmDateWithSource(lotRow)
expect('lot: lead_created_at beats last_customer_reply_at',
  lotResult.matchedAlias, 'lead_created_at')
expect('lot: sourceLabel is "Using lead created date"',
  lotResult.sourceLabel, 'Using lead created date')

// ── tests: mixed/unknown falls back to lead_created_at when reply absent ──────

console.log('\nextractCrmDateWithSource — mixed/unknown lead')

const mixedRow = {
  lead_created_at: DATE_60_DAYS_AGO,
  lead_source:     'Unknown Source',
}

const mixedResult = extractCrmDateWithSource(mixedRow)
expect('mixed: uses lead_created_at when no reply/activity date',
  mixedResult.matchedAlias, 'lead_created_at')
expect('mixed: sourceLabel is "Using lead created date"',
  mixedResult.sourceLabel, 'Using lead created date')

// ── tests: standard primary alias emits no sourceLabel ────────────────────────

console.log('\nextractCrmDateWithSource — standard primary aliases')

const standardRow = {
  inquiry_date: DATE_60_DAYS_AGO,
}

const standardResult = extractCrmDateWithSource(standardRow)
expect('standard inquiry_date: matchedAlias is inquiry_date',
  standardResult.matchedAlias, 'inquiry_date')
expectNull('standard inquiry_date: no sourceLabel (obvious column)',
  standardResult.sourceLabel)

const createdDateRow = {
  'Created Date': DATE_60_DAYS_AGO,
}

const createdResult = extractCrmDateWithSource(createdDateRow)
expect('Created Date: matchedAlias is created_date',
  createdResult.matchedAlias, 'created_date')
expectNull('Created Date: no sourceLabel (standard column)',
  createdResult.sourceLabel)

// ── tests: no usable date anywhere ────────────────────────────────────────────

console.log('\nextractCrmDateWithSource — no date present')

const noDateRow = {
  first_name: 'Jane',
  last_name:  'Doe',
  phone:      '6025551234',
}

const noDateResult = extractCrmDateWithSource(noDateRow)
expectNull('no date: date is null', noDateResult.date)
expectNull('no date: matchedAlias is null', noDateResult.matchedAlias)
expectNull('no date: sourceLabel is null', noDateResult.sourceLabel)

// ── tests: invalid date is ignored ────────────────────────────────────────────

console.log('\nextractCrmDateWithSource — invalid date strings')

const badDateRow = {
  lead_created_at:  'not-a-date',
  inquiry_date:     '2024-13-45',   // invalid month/day
  last_activity_at: DATE_30_DAYS_AGO,
}

const badDateResult = extractCrmDateWithSource(badDateRow)
expect('invalid dates skipped, falls to valid last_activity_at',
  badDateResult.matchedAlias, 'last_activity_at')
expectTruthy('invalid dates skipped: date is parsed', badDateResult.date)

// ── tests: classifyLeadAge missing-date message ───────────────────────────────

console.log('\nclassifyLeadAge — updated missing-date message')

const missingResult = classifyLeadAge(null)
expect('missing date: classification is needs_review',
  missingResult.classification, 'needs_review')
expectTruthy('missing date: warning starts with "No usable CRM date found"',
  missingResult.warning?.startsWith('No usable CRM date found'))

// ── tests: parseContactDate — various CRM formats ────────────────────────────

console.log('\nparseContactDate — CRM date format coverage')

expectTruthy('ISO date string', parseContactDate('2024-03-15'))
expectTruthy('US slash format', parseContactDate('03/15/2024'))
expectTruthy('ISO with time', parseContactDate('2024-03-15T10:30:00Z'))
expectTruthy('ISO datetime no Z', parseContactDate('2024-03-15 10:30:00'))
expectNull('empty string', parseContactDate(''))
expectNull('null', parseContactDate(null))
expectNull('invalid month', parseContactDate('2024-13-01'))
expectNull('invalid day', parseContactDate('2024-02-30'))
expectNull('garbage string', parseContactDate('not a date'))

// ── tests: last_contacted_at alias ───────────────────────────────────────────

console.log('\nextractCrmDateWithSource — last_contacted_at alias')

const contactedAtRow = {
  last_contacted_at: DATE_30_DAYS_AGO,
}

const contactedAtResult = extractCrmDateWithSource(contactedAtRow)
expect('last_contacted_at: alias recognized',
  contactedAtResult.matchedAlias, 'last_contacted_at')
expect('last_contacted_at: sourceLabel set',
  contactedAtResult.sourceLabel, 'Using last contacted date')

// ── tests: last_activity_at alias ────────────────────────────────────────────

console.log('\nextractCrmDateWithSource — last_activity_at alias')

const activityAtRow = {
  last_activity_at: DATE_60_DAYS_AGO,
}

const activityAtResult = extractCrmDateWithSource(activityAtRow)
expect('last_activity_at: alias recognized',
  activityAtResult.matchedAlias, 'last_activity_at')
expect('last_activity_at: sourceLabel set',
  activityAtResult.sourceLabel, 'Using last activity date')

// ── tests: showroom/visit aliases ────────────────────────────────────────────

console.log('\nextractCrmDateWithSource — showroom/lot aliases')

const showroomRow = {
  lead_source:         'showroom',
  showroom_visit_date: DATE_60_DAYS_AGO,
}

const showroomResult = extractCrmDateWithSource(showroomRow)
expect('showroom_visit_date: alias recognized for lot lead',
  showroomResult.matchedAlias, 'showroom_visit_date')
expect('showroom_visit_date: sourceLabel set',
  showroomResult.sourceLabel, 'Using showroom visit date')

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

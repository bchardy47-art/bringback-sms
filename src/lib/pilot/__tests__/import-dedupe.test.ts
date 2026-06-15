/**
 * Import dedupe tests — regression cover for the cross-session phone+email
 * dedupe added in the "import dedupe prevention + post-upload summary" packet.
 *
 * These exercise the pure helpers extracted from importLeads():
 *   - isValidNormalizedEmail  — email format gate (guardrail #2)
 *   - classifyImportDedupe   — decides whether a row should be skipped
 *   - summarizeImportRun     — builds the dealer-friendly summary (guardrail #3)
 *
 * Guardrails proved:
 *   #1 — backward compat: ImportRunResult shape unchanged (verified by tsc)
 *   #2 — phone match = dup; valid non-empty email = dup; blank/invalid = no dup
 *   #3 — duplicate summary (alreadyInQueue) is separate from status counts
 *   #4 — excluded/held rows absent from tenant maps → allow re-import
 *   #5 — all tests are pure-function (no DB, no Next.js, no network)
 *
 * Run with: npx tsx src/lib/pilot/__tests__/import-dedupe.test.ts
 */

import {
  classifyImportDedupe,
  isValidNormalizedEmail,
  summarizeImportRun,
} from '../lead-import'

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
function expectTrue(description: string, actual: boolean) {
  expect(description, actual, true)
}
function expectFalse(description: string, actual: boolean) {
  expect(description, actual, false)
}

// ── isValidNormalizedEmail ────────────────────────────────────────────────────

console.log('\n● isValidNormalizedEmail — email format gating (guardrail #2)')

{
  expectFalse('empty string is invalid',              isValidNormalizedEmail(''))
  expectFalse('no @ is invalid',                      isValidNormalizedEmail('notanemail'))
  expectFalse('@ at position 0 is invalid',           isValidNormalizedEmail('@example.com'))
  expectFalse('domain without dot is invalid',        isValidNormalizedEmail('a@localhost'))
  expectTrue ('typical email is valid',               isValidNormalizedEmail('user@example.com'))
  expectTrue ('short but valid domain (a.bc)',        isValidNormalizedEmail('x@a.bc'))
  expectTrue ('subdomain email is valid',             isValidNormalizedEmail('user@mail.example.com'))
  expectTrue ('+ addressing is valid',                isValidNormalizedEmail('user+tag@example.com'))
}

// ── classifyImportDedupe ──────────────────────────────────────────────────────

console.log('\n● classifyImportDedupe — empty maps mean no duplicates')

{
  const result = classifyImportDedupe('+15551234567', 'jane@example.com', new Map(), new Map())
  expect('returns { duplicate: false }', result, { duplicate: false })
}

console.log('\n● classifyImportDedupe — phone-only match')

{
  const tenantPhones = new Map([['+15551234567', 'existing-id-abc']])
  const tenantEmails = new Map<string, string>()
  const result = classifyImportDedupe('+15551234567', 'never-seen@example.com', tenantPhones, tenantEmails)
  expect('flags duplicate_phone',           (result as { duplicate: true; reason: string }).reason, 'duplicate_phone')
  expect('returns the existing import id',  (result as { duplicate: true; duplicateOfImportId: string | null }).duplicateOfImportId, 'existing-id-abc')
}

console.log('\n● classifyImportDedupe — email-only match')

{
  const tenantPhones = new Map<string, string>()
  const tenantEmails = new Map([['jane@example.com', 'existing-id-xyz']])
  const result = classifyImportDedupe('+15559999999', 'jane@example.com', tenantPhones, tenantEmails)
  expect('flags duplicate_email',          (result as { duplicate: true; reason: string }).reason, 'duplicate_email')
  expect('returns the existing import id', (result as { duplicate: true; duplicateOfImportId: string | null }).duplicateOfImportId, 'existing-id-xyz')
}

console.log('\n● classifyImportDedupe — phone AND email match (same row)')

{
  const tenantPhones = new Map([['+15551234567', 'existing-id-both']])
  const tenantEmails = new Map([['jane@example.com', 'existing-id-both']])
  const result = classifyImportDedupe('+15551234567', 'jane@example.com', tenantPhones, tenantEmails)
  expect('flags duplicate_phone_and_email', (result as { duplicate: true; reason: string }).reason, 'duplicate_phone_and_email')
  expect('returns phone-side id first',     (result as { duplicate: true; duplicateOfImportId: string | null }).duplicateOfImportId, 'existing-id-both')
}

console.log('\n● classifyImportDedupe — phone and email match DIFFERENT existing rows')

{
  // Edge case: input row's phone matches one existing record, its email
  // matches a DIFFERENT existing record. Treat as a duplicate against the
  // phone-side row (the more reliable identifier).
  const tenantPhones = new Map([['+15551234567', 'phone-side-id']])
  const tenantEmails = new Map([['jane@example.com', 'email-side-id']])
  const result = classifyImportDedupe('+15551234567', 'jane@example.com', tenantPhones, tenantEmails)
  expect('flags duplicate_phone_and_email', (result as { duplicate: true; reason: string }).reason, 'duplicate_phone_and_email')
  expect('prefers the phone-side match',    (result as { duplicate: true; duplicateOfImportId: string | null }).duplicateOfImportId, 'phone-side-id')
}

console.log('\n● classifyImportDedupe — null phone with matching email')

{
  // E.g. malformed phone number that didn't normalize, but the email still
  // links to an existing row.
  const tenantPhones = new Map<string, string>()
  const tenantEmails = new Map([['jane@example.com', 'email-only-id']])
  const result = classifyImportDedupe(null, 'jane@example.com', tenantPhones, tenantEmails)
  expect('flags duplicate_email',          (result as { duplicate: true; reason: string }).reason, 'duplicate_email')
  expect('returns the existing import id', (result as { duplicate: true; duplicateOfImportId: string | null }).duplicateOfImportId, 'email-only-id')
}

console.log('\n● classifyImportDedupe — both nulls means no duplicate')

{
  const result = classifyImportDedupe(null, null, new Map([['+15551234567', 'x']]), new Map([['x@y.com', 'y']]))
  expect('returns { duplicate: false }', result, { duplicate: false })
}

// ── Guardrail #2: email validity gate ─────────────────────────────────────────

console.log('\n● Guardrail #2 — invalid email never dedupes even if it matches the map')

{
  // A map entry with a malformed email address (e.g. stored from before the
  // validity gate). The gate in classifyImportDedupe must still block the match.
  const phones = new Map<string, string>()
  const emailsWithInvalid = new Map([
    ['badaddr@localhost', 'import-a'],   // no dot in domain
    ['',                  'import-b'],   // blank
  ])
  const noMatch1 = classifyImportDedupe(null, 'badaddr@localhost', phones, emailsWithInvalid)
  expectFalse('invalid email (no dot in domain) → not a duplicate', noMatch1.duplicate)

  const noMatch2 = classifyImportDedupe(null, '', phones, emailsWithInvalid)
  expectFalse('blank email → not a duplicate', noMatch2.duplicate)

  const noMatch3 = classifyImportDedupe(null, null, phones, emailsWithInvalid)
  expectFalse('null email → not a duplicate', noMatch3.duplicate)
}

// ── Guardrail test 1: same tenant + same phone = duplicate on second upload ───

console.log('\n● Guardrail test 1 — same tenant + same phone = duplicate on second upload')

{
  const tenantPhones = new Map<string, string>()
  const tenantEmails = new Map<string, string>()

  // First upload: phone not yet in map → not a duplicate
  const first = classifyImportDedupe('+14155550101', null, tenantPhones, tenantEmails)
  expect('first upload: not a duplicate', first, { duplicate: false })

  // After insert, importLeads() adds the phone to the map
  tenantPhones.set('+14155550101', 'import-first')

  // Second upload: same phone → duplicate
  const second = classifyImportDedupe('+14155550101', null, tenantPhones, tenantEmails)
  expect('second upload: duplicate_phone',
    second, { duplicate: true, reason: 'duplicate_phone', duplicateOfImportId: 'import-first' })
}

// ── Guardrail test 2: same tenant + same valid email = duplicate ──────────────

console.log('\n● Guardrail test 2 — same tenant + same valid email = duplicate on second upload')

{
  const tenantPhones = new Map<string, string>()
  const tenantEmails = new Map<string, string>()

  const first = classifyImportDedupe(null, 'buyer@example.com', tenantPhones, tenantEmails)
  expect('first upload: not a duplicate', first, { duplicate: false })

  tenantEmails.set('buyer@example.com', 'import-first')

  const second = classifyImportDedupe(null, 'buyer@example.com', tenantPhones, tenantEmails)
  expect('second upload: duplicate_email',
    second, { duplicate: true, reason: 'duplicate_email', duplicateOfImportId: 'import-first' })
}

// ── Guardrail test 3: blank emails do not collapse separate leads ──────────────

console.log('\n● Guardrail test 3 — blank emails do not collapse separate leads')

{
  // Even if '' were somehow in the email map, blank inputs are never matched
  // because isValidNormalizedEmail('') is false.
  const phones = new Map<string, string>()
  const emailsWithBlank = new Map([['', 'import-phantom']])

  const leadA = classifyImportDedupe('+14155550101', '', phones, emailsWithBlank)
  expectFalse('lead A with blank email: not a duplicate', leadA.duplicate)

  const leadB = classifyImportDedupe('+14155550202', '', phones, emailsWithBlank)
  expectFalse('lead B with blank email: not a duplicate', leadB.duplicate)

  // Confirm two leads with different phones don't collide on blank email
  phones.set('+14155550101', 'import-lead-a')
  const leadBAfterA = classifyImportDedupe('+14155550202', '', phones, emailsWithBlank)
  expectFalse('lead B (different phone) still not blocked by lead A blank email', leadBAfterA.duplicate)
}

// ── Guardrail test 4: different tenant can import same phone/email ─────────────

console.log('\n● Guardrail test 4 — different tenant: separate maps = no match')

{
  // Tenant A has the phone/email in their maps (scoped to their tenantId DB query)
  const tenantAPhones = new Map([['+14155550101', 'import-tenant-a']])
  const tenantAEmails = new Map([['buyer@example.com', 'import-tenant-a']])

  // Tenant B's maps are empty (their DB query returns no matching rows)
  const tenantBPhones = new Map<string, string>()
  const tenantBEmails = new Map<string, string>()

  const tenantBPhone = classifyImportDedupe('+14155550101', null, tenantBPhones, tenantBEmails)
  expectFalse('tenant B: same phone not in tenant B map → not a duplicate', tenantBPhone.duplicate)

  const tenantBEmail = classifyImportDedupe(null, 'buyer@example.com', tenantBPhones, tenantBEmails)
  expectFalse('tenant B: same email not in tenant B map → not a duplicate', tenantBEmail.duplicate)

  // Confirm tenant A would block the same inputs (isolation is real)
  const tenantAPhone = classifyImportDedupe('+14155550101', null, tenantAPhones, tenantAEmails)
  expectTrue('tenant A: same phone → duplicate (confirming isolation is real)', tenantAPhone.duplicate)
}

// ── Guardrail test 5: excluded/held rows do not block re-import ───────────────

type MockImportRow = { id: string; phone: string | null; email: string | null; importStatus: string }

function buildMapsFromRows(rows: MockImportRow[]): { phones: Map<string, string>; emails: Map<string, string> } {
  const phones = new Map<string, string>()
  const emails = new Map<string, string>()
  for (const row of rows) {
    if (row.phone) phones.set(row.phone, row.id)
    if (row.email) emails.set(row.email, row.id)
  }
  return { phones, emails }
}

console.log('\n● Guardrail test 5 — excluded/held rows absent from prefetch map → allow re-import')

{
  // The importLeads() prefetch query uses:
  //   notInArray(importStatus, ['excluded', 'held'])
  // So excluded/held rows are never placed in tenantPhones/tenantEmails.
  // We simulate the map-building: only active rows go in the map.

  const activeRows: MockImportRow[] = [
    { id: 'import-active', phone: '+14155550303', email: 'active@example.com', importStatus: 'eligible' },
  ]
  const inactiveRows: MockImportRow[] = [
    { id: 'import-excluded', phone: '+14155550404', email: 'excluded@example.com', importStatus: 'excluded' },
    { id: 'import-held',     phone: '+14155550505', email: 'held@example.com',     importStatus: 'held' },
  ]

  // Maps built from active rows only (as the real code does via the WHERE clause)
  const { phones, emails } = buildMapsFromRows(activeRows)

  // Active phone → blocked (expected behavior, baseline)
  const activeBlock = classifyImportDedupe('+14155550303', null, phones, emails)
  expectTrue('active row phone → duplicate (baseline)', activeBlock.duplicate)

  // Excluded phone → not in map → allowed to re-import
  const excludedPhone = classifyImportDedupe('+14155550404', null, phones, emails)
  expectFalse('excluded row phone not in map → not a duplicate', excludedPhone.duplicate)

  // Held phone → not in map → allowed to re-import
  const heldPhone = classifyImportDedupe('+14155550505', null, phones, emails)
  expectFalse('held row phone not in map → not a duplicate', heldPhone.duplicate)

  // Demonstrate the gate is in the DB query: if inactive rows were erroneously
  // added to the map they WOULD block (proving the WHERE clause is load-bearing)
  const { phones: inactivePhones } = buildMapsFromRows(inactiveRows)
  const phonesWithInactive = new Map<string, string>(phones)
  inactivePhones.forEach((v, k) => phonesWithInactive.set(k, v))
  const wouldBlock = classifyImportDedupe('+14155550404', null, phonesWithInactive, emails)
  expectTrue('if excluded rows were in map they WOULD block (notInArray is the gate)', wouldBlock.duplicate)
}

// ── summarizeImportRun ────────────────────────────────────────────────────────

console.log('\n● summarizeImportRun — all-new run')

{
  const inserted = [
    { importStatus: 'eligible' },
    { importStatus: 'eligible' },
    { importStatus: 'warning' },
    { importStatus: 'blocked' },
    { importStatus: 'needs_review' },
  ]
  const summary = summarizeImportRun(inserted, 0, 5)
  expect('totalInput',     summary.totalInput,     5)
  expect('created',        summary.created,        5)
  expect('alreadyInQueue', summary.alreadyInQueue, 0)
  expect('eligible',       summary.eligible,       2)
  expect('warning',        summary.warning,        1)
  expect('blocked',        summary.blocked,        1)
  expect('needsReview',    summary.needsReview,    1)
  expect('held',           summary.held,           0)
  expect('selected',       summary.selected,       0)
}

console.log('\n● summarizeImportRun — same-CSV-reuploaded run (all duplicates)')

{
  // Dealer uploads the same CSV twice. The second run creates zero new rows
  // and reports every input as already in the queue.
  const inserted: Array<{ importStatus: string }> = []
  const summary = summarizeImportRun(inserted, 12, 12)
  expect('totalInput',     summary.totalInput,     12)
  expect('created',        summary.created,        0)
  expect('alreadyInQueue', summary.alreadyInQueue, 12)
  expect('all status buckets zero', {
    eligible:    summary.eligible,
    warning:     summary.warning,
    blocked:     summary.blocked,
    needsReview: summary.needsReview,
    held:        summary.held,
    selected:    summary.selected,
  }, {
    eligible: 0, warning: 0, blocked: 0, needsReview: 0, held: 0, selected: 0,
  })
}

console.log('\n● summarizeImportRun — partial dedupe (mixed run) — guardrail #3')

{
  // Guardrail #3: alreadyInQueue is separate from the per-status counts.
  // 5 rows submitted: 3 created, 2 already in queue.
  const inserted = [
    { importStatus: 'eligible' },
    { importStatus: 'eligible' },
    { importStatus: 'warning' },
  ]
  const summary = summarizeImportRun(inserted, 2, 5)
  expect('totalInput',     summary.totalInput,     5)
  expect('created',        summary.created,        3)
  expect('alreadyInQueue', summary.alreadyInQueue, 2)
  expect('eligible',       summary.eligible,       2)
  expect('warning',        summary.warning,        1)
  expectTrue('created + alreadyInQueue = totalInput', summary.created + summary.alreadyInQueue === summary.totalInput)
  expectTrue('eligible + warning = created',          summary.eligible + summary.warning === summary.created)
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${failed === 0 ? '✅' : '❌'} import-dedupe: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)

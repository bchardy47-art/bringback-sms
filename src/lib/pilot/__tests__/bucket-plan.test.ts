/**
 * computeBucketPlan tests — regression cover for the dealer-import
 * Step 3 "not assigned to a campaign group" dead end.
 *
 * Pure-function tests — no DB, no Next.js.
 * Run with: npx tsx src/lib/pilot/__tests__/bucket-plan.test.ts
 */

import { computeBucketPlan, type BucketPlanLead } from '../bucket-plan'

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

// ── Fixture builder ──────────────────────────────────────────────────────────

function lead(overrides: Partial<BucketPlanLead> = {}): BucketPlanLead {
  return {
    id:                 overrides.id ?? `id-${Math.random().toString(36).slice(2, 9)}`,
    firstName:          overrides.firstName ?? 'First',
    lastName:           overrides.lastName ?? 'Last',
    importStatus:       overrides.importStatus ?? 'selected',
    ageBucket:          overrides.ageBucket ?? null,
    assignedWorkflowId: overrides.assignedWorkflowId ?? null,
    enrollAfter:        overrides.enrollAfter ?? null,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\n● bucket-plan — selected rows with age buckets')

{
  // The regression case: selected leads have ageBucket set but the tenant has
  // no per-bucket workflow yet, so assignedWorkflowId is null on every row.
  // Old logic: bucketPlan was empty, Step 3 fired the false banner.
  // New logic: bucketPlan groups by ageBucket regardless of workflow assignment.
  const rows = [
    lead({ id: '1', firstName: 'Mason', lastName: 'Reed',  ageBucket: 'a' }),
    lead({ id: '2', firstName: 'Ava',   lastName: 'Cole',  ageBucket: 'a' }),
    lead({ id: '3', firstName: 'Liam',  lastName: 'Parker',ageBucket: 'b' }),
    lead({ id: '4', firstName: 'Emma',  lastName: 'Hayes', ageBucket: 'b' }),
    lead({ id: '5', firstName: 'Noah',  lastName: 'Bryant',ageBucket: 'c' }),
  ]
  const { bucketPlan, unassignable } = computeBucketPlan(rows)
  expect('plan has one item per distinct bucket',                   bucketPlan.length,         3)
  expect('plan groups two A leads',                                  bucketPlan[0].leadCount,   2)
  expect('A bucket label matches DEALER_BUCKET_LABEL',              bucketPlan[0].bucketLabel, '14–30 Day Follow-Up')
  expect('B bucket label matches DEALER_BUCKET_LABEL',              bucketPlan[1].bucketLabel, '31–60 Day Follow-Up')
  expect('C bucket label matches DEALER_BUCKET_LABEL',              bucketPlan[2].bucketLabel, '61–90 Day Revival')
  expect('plan is sorted A → C',                                     bucketPlan.map(b => b.ageBucket), ['a', 'b', 'c'])
  expect('no unassignable selected leads',                          unassignable.length,       0)
  expect('placeholder workflowId is bucket-keyed when none assigned', bucketPlan[0].workflowId, 'bucket:a')
}

console.log('\n● bucket-plan — assignedWorkflowId carried through when present')

{
  // When the tenant DOES have a bucket workflow, the existing workflowId is
  // surfaced in the BucketPlanItem so the UI still keys off the real row.
  const rows = [
    lead({ id: '1', ageBucket: 'a', assignedWorkflowId: 'wf-real' }),
    lead({ id: '2', ageBucket: 'a', assignedWorkflowId: 'wf-real' }),
  ]
  const { bucketPlan } = computeBucketPlan(rows)
  expect('one plan item',           bucketPlan.length,         1)
  expect('uses real workflow id',   bucketPlan[0].workflowId,  'wf-real')
  expect('counts both leads',       bucketPlan[0].leadCount,   2)
}

console.log('\n● bucket-plan — selected rows without age bucket surface per-row reasons')

{
  // Edge case the user explicitly called out: when a selected lead truly has
  // no bucket, we must NOT pretend the banner applies to every selected row.
  // Instead, surface the per-row reason so the dealer can act.
  const heldDate = new Date('2026-06-29T12:00:00Z')
  const rows = [
    lead({ id: '1', firstName: 'Mason', lastName: 'Reed', ageBucket: 'a' }),
    lead({
      id:           '2',
      firstName:    'Caleb',
      lastName:     'Morris',
      ageBucket:    null,
      importStatus: 'needs_review',
    }),
    lead({
      id:           '3',
      firstName:    'Harper',
      lastName:     'Ross',
      ageBucket:    null,
      importStatus: 'held',
      enrollAfter:  heldDate,
    }),
  ]
  const { bucketPlan, unassignable } = computeBucketPlan(rows)
  expect('plan only contains the bucketed lead', bucketPlan.length,          1)
  expect('plan counts Mason',                    bucketPlan[0].leadCount,    1)
  expect('unassignable has 2 entries',           unassignable.length,        2)
  expect('Caleb explanation calls out missing date',
    unassignable[0].reason,
    'No usable contact date — re-import this lead with a recognised date column.',
  )
  expect('Harper explanation includes the unhold date',
    unassignable[1].reason,
    'Held until 2026-06-29 — too fresh for outreach (within the 14-day hold window).',
  )
}

console.log('\n● bucket-plan — empty input is a no-op')

{
  const { bucketPlan, unassignable } = computeBucketPlan([])
  expect('plan is empty',          bucketPlan.length,    0)
  expect('unassignable is empty',  unassignable.length,  0)
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${failed === 0 ? '✅' : '❌'} bucket-plan: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)

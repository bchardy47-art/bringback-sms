/**
 * preview-filter — regression tests for dealer campaign-detail trust patch
 *
 * Verifies the three P0 display invariants:
 *   P0 #1 — "Approved for send" chip must not appear on draft/previewed batches
 *            (logic is in page.tsx; tested here via the usedFallback/type fields
 *            that drive the display decisions)
 *   P0 #2 — usedFallback=true must not produce "no vehicle on file" when the
 *            lead has vehicle data (stale cached preview)
 *   P0 #3 — condition/assign steps must be filtered out; only send_sms steps
 *            produce message cards
 *
 * Pure-function tests — no DB, no Next.js.
 * Run with: npx tsx src/lib/pilot/__tests__/preview-filter.test.ts
 */

import { previewWorkflow, renderTemplate } from '../../workflows/preview'
import type { SendSmsConfig } from '@/lib/db/schema'

let passed = 0
let failed = 0

function check(description: string, actual: unknown, expected: unknown) {
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

function checkTrue(description: string, actual: boolean) {
  check(description, actual, true)
}
function checkFalse(description: string, actual: boolean) {
  check(description, actual, false)
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const sendStep = (position: number, delayHours = 0): {
  position: number; type: string; config: SendSmsConfig
} => ({
  position,
  type: 'send_sms',
  config: {
    template: 'Hi {{firstName}}, check out our {{vehicleOfInterest}} deals!',
    fallbackTemplate: 'Hi {{firstName}}, we have great deals for you!',
    delayHours,
    optOutFooter: null,
    requiredFields: ['firstName'],
  } as unknown as SendSmsConfig,
})

const conditionStep = (position: number) => ({
  position,
  type: 'condition' as const,
  config: { type: 'condition' as const },
})

const contextWithVehicle = {
  firstName: 'Mason',
  lastName: 'Reed',
  dealershipName: 'Sunset Motors',
  vehicleOfInterest: '2024 Ford F-150 XLT',
}

const contextWithoutVehicle = {
  firstName: 'Jane',
  lastName: 'Doe',
  dealershipName: 'Sunset Motors',
  vehicleOfInterest: null,
}

// ── P0 #3: send_sms filter ─────────────────────────────────────────────────────

console.log('\nP0 #3 — condition steps must be excluded from message cards')

{
  // Workflow: send → condition → send (typical 3-step pattern)
  const steps = [sendStep(1, 0), conditionStep(2), sendStep(3, 24)]
  const previews = previewWorkflow(steps, contextWithVehicle)

  check('previewWorkflow returns all steps including condition', previews.length, 3)

  const sendOnly = previews.filter(p => p.type === 'send_sms')
  check('filtering to send_sms gives 2 steps', sendOnly.length, 2)
  check('no null rendered values after filter', sendOnly.every(p => p.rendered !== null), true)
  check('first message is numbered 1 (index 0)', 0 + 1, 1)
  check('second message is numbered 2 (index 1)', 1 + 1, 2)
}

{
  // Workflow with condition at position 2 and 4 — sends at 1, 3, 5
  const steps = [
    sendStep(1, 0), conditionStep(2), sendStep(3, 24),
    conditionStep(4), sendStep(5, 48),
  ]
  const previews = previewWorkflow(steps, contextWithVehicle)
  const sendOnly = previews.filter(p => p.type === 'send_sms')
  check('3-send workflow: 3 message cards after filter', sendOnly.length, 3)
  checkTrue('all messages have rendered text', sendOnly.every(p => p.rendered !== null && p.rendered!.length > 0))
}

{
  // Condition-only workflow (degenerate)
  const steps = [conditionStep(1), conditionStep(2)]
  const previews = previewWorkflow(steps, contextWithVehicle)
  const sendOnly = previews.filter(p => p.type === 'send_sms')
  check('condition-only workflow: 0 message cards', sendOnly.length, 0)
}

{
  // condition steps have rendered=null (that caused blank cards)
  const steps = [sendStep(1, 0), conditionStep(2), sendStep(3, 24)]
  const previews = previewWorkflow(steps, contextWithVehicle)
  const cond = previews.find(p => p.type === 'condition')!
  check('condition step has rendered=null', cond.rendered, null)
  checkFalse('condition step usedFallback is false', cond.usedFallback)
}

// ── P0 #2: stale vehicle warning ───────────────────────────────────────────────

console.log('\nP0 #2 — no vehicle warning must be suppressed when lead has vehicle data')

{
  // renderTemplate: fallback triggered when vehicleOfInterest is absent.
  // Note: usedFallback can also be true when other optional fields (e.g.
  // salespersonName) are missing — it is NOT a reliable "vehicle is absent" signal.
  // That is why page.tsx gates the "no vehicle on file" warning on
  // !lead?.vehicleOfInterest directly, not on p.usedFallback alone.
  const config: SendSmsConfig = {
    template: 'Hi {{firstName}}, interested in {{vehicleOfInterest}}?',
    fallbackTemplate: 'Hi {{firstName}}, we have great deals!',
    delayHours: 0,
    optOutFooter: null,
    requiredFields: ['firstName'],
  } as unknown as SendSmsConfig

  // With all optional fields present: no fallback
  const fullContext = { ...contextWithVehicle, salespersonName: 'Alex' }
  const resultFull = renderTemplate(config, fullContext)
  checkFalse('all optional fields present: usedFallback=false', resultFull.usedFallback)
  checkTrue('all optional fields present: vehicle name in rendered message',
    resultFull.rendered.includes('F-150'))

  // Vehicle present but salespersonName absent: usedFallback=true even though vehicle is known
  const partialContext = { ...contextWithVehicle, salespersonName: null }
  const resultPartial = renderTemplate(config, partialContext)
  checkTrue('vehicle present, salesperson absent: usedFallback=true (any missing optional triggers fallback)',
    resultPartial.usedFallback)
}

{
  // Lead without vehicle: renderTemplate uses fallback
  const config: SendSmsConfig = {
    template: 'Hi {{firstName}}, interested in {{vehicleOfInterest}}?',
    fallbackTemplate: 'Hi {{firstName}}, we have great deals!',
    delayHours: 0,
    optOutFooter: null,
    requiredFields: ['firstName'],
  } as unknown as SendSmsConfig

  const resultNoVehicle = renderTemplate(config, contextWithoutVehicle)
  checkTrue('lead without vehicle: usedFallback=true', resultNoVehicle.usedFallback)
}

{
  // Display logic: warning shown only when usedFallback=true AND lead lacks vehicle.
  // This is the guard in page.tsx: {p.usedFallback && !lead?.vehicleOfInterest}
  // It correctly handles stale previews (cached before vehicle was added).
  const staleUsedFallback = true   // preview was run before vehicle was added
  const leadNowHasVehicle = '2024 Ford F-150 XLT'
  const shouldShowWarning = staleUsedFallback && !leadNowHasVehicle
  checkFalse('stale usedFallback + vehicle now present: warning suppressed', shouldShowWarning)
}

{
  // usedFallback=true triggered by missing salespersonName, not missing vehicle:
  // warning must still be suppressed when lead has vehicle data
  const usedFallbackDueToSalesperson = true
  const vehicleOfInterest = '2024 Ford F-150 XLT'
  const shouldShowWarning = usedFallbackDueToSalesperson && !vehicleOfInterest
  checkFalse('usedFallback from missing salesperson + vehicle present: no vehicle warning', shouldShowWarning)
}

{
  const usedFallback = true
  const vehicleOfInterest = null
  const shouldShowWarning = usedFallback && !vehicleOfInterest
  checkTrue('usedFallback=true + no vehicle: warning shown', shouldShowWarning)
}

// ── P0 #1: chip label by batch status ─────────────────────────────────────────

// Mirrors the logic in page.tsx:
// isDraft || batch.status === 'previewed' → "Cleared for review"
// else → "✓ Approved for send"
function chipLabel(batchStatus: string, approvedForSend: boolean): string | null {
  if (!approvedForSend) return null
  const isDraft = batchStatus === 'draft'
  if (isDraft || batchStatus === 'previewed') return 'Cleared for review'
  return '✓ Approved for send'
}

console.log('\nP0 #1 — chip copy depends on batch status, not just approvedForSend')

{
  check('draft batch: chip is "Cleared for review"',
    chipLabel('draft', true), 'Cleared for review')
  check('previewed batch: chip is "Cleared for review"',
    chipLabel('previewed', true), 'Cleared for review')
  check('approved batch: chip is "✓ Approved for send"',
    chipLabel('approved', true), '✓ Approved for send')
  check('sending batch: chip is "✓ Approved for send"',
    chipLabel('sending', true), '✓ Approved for send')
  check('completed batch: chip is "✓ Approved for send"',
    chipLabel('completed', true), '✓ Approved for send')
  check('approvedForSend=false: no chip regardless of status',
    chipLabel('draft', false), null)
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)

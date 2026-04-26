/**
 * DLR webhook simulation script — exercise the live loop without Telnyx.
 *
 * Signature verification is skipped in development (NODE_ENV !== 'production'),
 * so these payloads are accepted as-is.
 *
 * Usage:
 *   npx tsx scripts/simulate-webhook.ts <scenario>
 *
 * Scenarios:
 *   outbound-sent      — message.sent for a queued outbound message
 *   outbound-delivered — message.delivered for a sent outbound message
 *   delivery-failed    — message.delivery_failed (provider couldn't deliver)
 *   inbound-reply      — message.received (lead replies positively)
 *   inbound-stop       — message.received with STOP keyword
 *   inbound-unstop     — message.received with UNSTOP keyword
 *   duplicate          — sends inbound-reply twice (idempotency check)
 *
 * Environment:
 *   BASE_URL — defaults to http://localhost:3000
 *   SIM_PROVIDER_MSG_ID — override the providerMessageId used (for debugging)
 *   SIM_LEAD_PHONE — override the lead phone number (default: first seeded lead)
 *   SIM_TENANT_PHONE — override the tenant/DLR phone number (default: +15550000000)
 */

import 'dotenv/config'

const BASE_URL       = process.env.BASE_URL         ?? 'http://localhost:3000'
const TENANT_PHONE   = process.env.SIM_TENANT_PHONE ?? '+15550000000'
const LEAD_PHONE     = process.env.SIM_LEAD_PHONE   ?? '+15550101001' // Marcus Delgado
const MSG_ID         = process.env.SIM_PROVIDER_MSG_ID ?? `sim-${Date.now()}`

const WEBHOOK_URL = `${BASE_URL}/api/webhooks/telnyx`

// ── Payload builders ──────────────────────────────────────────────────────────

function statusPayload(eventType: string, msgId: string) {
  return {
    data: {
      event_type: eventType,
      payload: {
        id: msgId,
        from: { phone_number: TENANT_PHONE },
        to: [{ phone_number: LEAD_PHONE, status: eventType.split('.')[1] }],
        direction: 'outbound',
        text: 'Hi Marcus, this is Demo Dealership...',
        completed_at: new Date().toISOString(),
        errors: eventType.includes('fail') ? [{ title: 'Carrier rejected', code: '40008' }] : [],
      },
    },
  }
}

function inboundPayload(body: string, msgId: string) {
  return {
    data: {
      event_type: 'message.received',
      payload: {
        id: msgId,
        from: { phone_number: LEAD_PHONE },
        to: [{ phone_number: TENANT_PHONE }],
        direction: 'inbound',
        text: body,
        received_at: new Date().toISOString(),
        media: [],
      },
    },
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

async function post(payload: unknown, label: string) {
  console.log(`\n→ POST ${WEBHOOK_URL}`)
  console.log(`  scenario : ${label}`)
  console.log(`  msgId    : ${(payload as { data: { payload: { id: string } } }).data.payload.id}`)

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const body = await res.text()
  console.log(`  status   : ${res.status}`)
  console.log(`  response : ${body}`)

  if (res.status !== 200) {
    console.error('  ❌ Expected 200')
    process.exitCode = 1
  } else {
    console.log('  ✅ OK')
  }
}

async function run() {
  const scenario = process.argv[2]

  if (!scenario) {
    console.error('Usage: npx tsx scripts/simulate-webhook.ts <scenario>')
    console.error('Scenarios: outbound-sent | outbound-delivered | delivery-failed | inbound-reply | inbound-stop | inbound-unstop | duplicate')
    process.exit(1)
  }

  switch (scenario) {
    case 'outbound-sent':
      await post(statusPayload('message.sent', MSG_ID), scenario)
      break

    case 'outbound-delivered':
      // Simulate natural progression: sent → delivered
      await post(statusPayload('message.sent', MSG_ID), 'message.sent')
      await post(statusPayload('message.delivered', MSG_ID), 'message.delivered')
      break

    case 'delivery-failed':
      await post(statusPayload('message.delivery_failed', MSG_ID), scenario)
      break

    case 'inbound-reply':
      await post(
        inboundPayload('Yes! I am still interested, what do you have available?', MSG_ID),
        scenario,
      )
      break

    case 'inbound-stop':
      await post(inboundPayload('STOP', MSG_ID), scenario)
      break

    case 'inbound-unstop':
      await post(inboundPayload('UNSTOP', MSG_ID), scenario)
      break

    case 'duplicate': {
      // Same providerMessageId sent twice — second should be a no-op
      const dupId = `dup-${Date.now()}`
      const payload = inboundPayload('I am interested!', dupId)
      console.log('\n── First delivery ──')
      await post(payload, 'inbound-reply (1st)')
      console.log('\n── Duplicate delivery ──')
      await post(payload, 'inbound-reply (2nd, should be no-op)')
      break
    }

    default:
      console.error(`Unknown scenario: ${scenario}`)
      console.error('Valid scenarios: outbound-sent | outbound-delivered | delivery-failed | inbound-reply | inbound-stop | inbound-unstop | duplicate')
      process.exit(1)
  }
}

run().catch((err) => {
  console.error('Simulation error:', err)
  process.exit(1)
})

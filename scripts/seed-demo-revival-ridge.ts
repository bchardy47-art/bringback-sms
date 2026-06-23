/**
 * Demo seed — "Revival Ridge Motors" for demo@dlr-sms.com
 * ----------------------------------------------------------------------------
 * Populates the demo dealer tenant with realistic-but-fake data so the dealer
 * portal looks operational for a guided walkthrough. SAFE BY CONSTRUCTION:
 *
 *   • Every seeded lead has doNotAutomate=true  → send-guard hard-cancels it.
 *   • Every seeded lead has isTest=false        → so dashboard KPIs still count
 *     them (the dashboard intentionally excludes isTest leads). Safety comes
 *     from doNotAutomate + tenant gates, NOT from isTest.
 *   • Tenant gates are LOCKED, never weakened: automationPaused=true,
 *     smsLiveApproved=false, tenDlcStatus='not_started', complianceBlocked=false.
 *   • NO workflow enrollments / step executions are created → the BullMQ worker
 *     has nothing to pick up. Nothing is ever queued or sent.
 *   • Campaign batches are draft/previewed/completed only — never 'sending'.
 *   • Messages are historical rows with provider='demo_seed' (not telnyx) — they
 *     are records, not sends. No provider API is ever called.
 *   • Phone numbers are fictitious (555-01xx across several area codes).
 *
 * HONESTY MARKERS (obvious internally, subtle in UI):
 *   leads.crmSource='demo_seed', leads.metadata.demoSeed=true,
 *   messages.provider='demo_seed', optOuts.source='demo_seed',
 *   workflows.key='demo_seed:*', batches.createdBy='demo_seed',
 *   555-01xx phone numbers, consent notes "DEMO SEED DATA".
 *
 * IDEMPOTENT + REVERSIBLE: re-running deletes prior demo-tagged rows for THIS
 * tenant only, then reinserts. `--cleanup` deletes without reseeding. The
 * tenant + user rows are preserved (only the demo data is wiped).
 *
 * Usage (LOCAL ONLY for now):
 *   npx tsx scripts/seed-demo-revival-ridge.ts            # cleanup + seed
 *   npx tsx scripts/seed-demo-revival-ridge.ts --cleanup  # cleanup only
 *
 * It reads DATABASE_URL from the environment (loaded from .env.local locally).
 */

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { eq, and, inArray, like } from 'drizzle-orm'
import { db } from '../src/lib/db'
import {
  tenants,
  users,
  workflows,
  leads,
  conversations,
  messages,
  optOuts,
  pilotBatches,
  pilotBatchLeads,
  pilotLeadImports,
  type PilotPreviewMessage,
  type PilotEligibilityResult,
} from '../src/lib/db/schema'

// ── Identity ────────────────────────────────────────────────────────────────
const DEMO_EMAIL   = 'demo@dlr-sms.com'
const DEMO_NAME    = 'Revival Ridge Demo'
const TENANT_NAME  = 'Revival Ridge Motors'
const TENANT_SLUG  = 'revival-ridge-motors'
const DEMO_PHONE   = '+13855550100' // fictitious dealership number (555-01xx)
const SEED_TAG     = 'revival-ridge-v1'
const DEMO_SOURCE  = 'demo_seed'
// Password is only set when the user is CREATED (never overwrites an existing one).
const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'RevivalRidge!demo1'

// ── Target composition (drives the dashboard KPIs) ──────────────────────────
const N_SELECTED   = 186 // import 'selected' w/ promoted lead  → Ready/Selected
const N_ELIGIBLE   = 37  // import 'eligible' (no lead)          → counts in Customer Leads
const N_BLOCKED    = 25  // import 'blocked'  (no lead)          → Blocked/Needs consent
const N_WARNING    = 37  // import 'warning'  (no lead)          → In Review hint
//   Customer Leads (importCount) = SELECTED + ELIGIBLE + BLOCKED = 248
//   In Review (queue - importCount) = WARNING = 37
const N_OPEN_CONVOS      = 58  // open conversations  → Conversations KPI
const N_OUTBOUND_TARGET  = 412 // outbound messages   → Messages Sent KPI
const N_COMPLETED_BATCHES = 3  // completed campaigns → Deals Revived KPI

// ── Fictitious data pools ───────────────────────────────────────────────────
const AREA_CODES = ['385', '801', '435', '208'] // Utah/Idaho region; 400 fake #s
let phoneCounter = 0
function nextFakePhone(): string {
  // 555-01xx is the reserved fictitious range. Cycle area codes for volume.
  const area = AREA_CODES[Math.floor(phoneCounter / 100) % AREA_CODES.length]
  const last = String(100 + (phoneCounter % 100)) // 0100..0199
  phoneCounter += 1
  return `+1${area}555${last.padStart(4, '0')}`
}

const FIRST_NAMES = ['Jake','Maria','Tyler','Ashley','Brandon','Crystal','Derek','Megan','Cody','Brittany','Hunter','Kayla','Travis','Amber','Logan','Sierra','Dustin','Paige','Garrett','Chelsea','Wyatt','Jordan','Colton','Destiny','Mason','Haley','Bryce','Kaylee','Trevor','Madison']
const LAST_NAMES  = ['Anderson','Nguyen','Martinez','Johnson','Larsen','Hansen','Romero','Olsen','Bishop','Carter','Reyes','Walker','Christensen','Brooks','Flores','Bennett','Howard','Sanchez','Price','Wells','Jensen','Vasquez','Coleman','Powell','Foster','Cox','Stewart','Morales','Barnes','Hughes']
const TRUCKS = [
  '2019 Ford F-150 XLT','2020 RAM 1500 Big Horn','2018 Chevy Silverado 1500','2021 Toyota Tacoma TRD',
  '2017 GMC Sierra 1500','2019 Ford F-250 Lariat','2020 Jeep Gladiator','2018 Toyota Tundra SR5',
  '2016 Nissan Titan','2021 Ford Bronco','2019 Chevy Tahoe LT','2020 Ford Expedition',
  '2018 Toyota 4Runner','2019 Honda Pilot','2017 Dodge Durango','2020 Chevy Suburban',
]
function pick<T>(arr: T[], i: number): T { return arr[i % arr.length] }
function daysAgo(n: number): Date { return new Date(Date.now() - n * 24 * 60 * 60 * 1000) }

// ── Campaigns (mapped onto the app's fixed age buckets a–d) ─────────────────
// NOTE: the dealer UI groups campaigns by age bucket and labels the cards with
// its own copy. These names live on the workflow rows; #5 has no bucket so it
// won't get its own bucket card (documented limitation).
const CAMPAIGNS = [
  { key: 'demo_seed:a', name: '14–30 Day Follow-Up',       bucket: 'a',  status: 'previewed' },
  { key: 'demo_seed:b', name: '31–60 Day Still Looking',   bucket: 'b',  status: 'draft'     },
  { key: 'demo_seed:c', name: 'Trade-In Check-In',         bucket: 'c',  status: 'draft'     },
  { key: 'demo_seed:d', name: 'Credit Reconnect',          bucket: 'd',  status: 'previewed' },
  { key: 'demo_seed:e', name: 'Service-to-Sales Upgrade',  bucket: null, status: 'draft'     },
] as const

function previewFor(name: string, vehicle: string): PilotPreviewMessage[] {
  const bodies: Record<string, string[]> = {
    '14–30 Day Follow-Up': [
      `Hi {firstName}, it's Revival Ridge Motors. Still interested in the ${vehicle}? Happy to hold it for you. Reply STOP to opt out.`,
      `Just checking in — we can get you numbers on the ${vehicle} today. Want me to send them? Reply STOP to opt out.`,
    ],
    '31–60 Day Still Looking': [
      `Hi {firstName}, Revival Ridge Motors here. New trucks landed this week that match what you wanted. Want a quick look? Reply STOP to opt out.`,
      `Still shopping? We just took in a few clean SUVs under budget. Reply YES for photos. Reply STOP to opt out.`,
    ],
    'Trade-In Check-In': [
      `Hi {firstName}, trade values are up right now. Want a free estimate on your current vehicle toward the ${vehicle}? Reply STOP to opt out.`,
    ],
    'Credit Reconnect': [
      `Hi {firstName}, Revival Ridge Motors. We have new lender programs that may fit better now. Want to re-check your options? Reply STOP to opt out.`,
    ],
    'Service-to-Sales Upgrade': [
      `Hi {firstName}, thanks for servicing with us. With your vehicle's value today, an upgrade could lower your payment. Interested? Reply STOP to opt out.`,
    ],
  }
  const list = bodies[name] ?? bodies['14–30 Day Follow-Up']
  return list.map((rendered, i) => ({
    position: i + 1,
    type: 'send_sms' as const,
    rendered,
    usedFallback: false,
    delayHours: i === 0 ? 0 : 48,
    label: i === 0 ? 'Initial outreach' : `Follow-up ${i}`,
  }))
}

const ELIGIBLE_OK: PilotEligibilityResult = {
  eligible: true,
  checks: [
    { id: 'consent',   passed: true, detail: 'Consent on file' },
    { id: 'phone',     passed: true, detail: 'Valid mobile number' },
    { id: 'not_opted', passed: true, detail: 'Not opted out' },
  ],
}

// ── Demo conversation examples (inbound replies) ────────────────────────────
const EXAMPLE_REPLIES = [
  { body: 'Yeah I’m still looking. Do you have anything under $25k?', status: 'open' as const,      state: 'responded' as const },
  { body: 'I bought already, thanks.',                                status: 'closed' as const,    state: 'converted' as const },
  { body: 'Can you send trucks with 3rd row seating?',               status: 'open' as const,      state: 'responded' as const },
  { body: 'What’s my trade worth?',                                  status: 'open' as const,      state: 'responded' as const },
  { body: 'I can come by Saturday morning.',                         status: 'open' as const,      state: 'responded' as const },
  { body: 'STOP',                                                    status: 'opted_out' as const, state: 'opted_out' as const },
]

const OUTBOUND_BODIES = [
  'Hi {name}, it’s Revival Ridge Motors following up on your truck search. Reply STOP to opt out.',
  'We just got a few clean trucks in your range. Want photos? Reply STOP to opt out.',
  'Still happy to hold one for a test drive this week. Reply STOP to opt out.',
  'Quick check-in — any questions on financing? Reply STOP to opt out.',
  'Trade values are strong right now if you want a free estimate. Reply STOP to opt out.',
  'We can do numbers over text if that’s easier. Reply STOP to opt out.',
  'Saturdays are our quietest day if you’d like a relaxed look. Reply STOP to opt out.',
]

// ─────────────────────────────────────────────────────────────────────────────

function maskedHost(): string {
  const url = process.env.DATABASE_URL ?? ''
  const m = url.match(/@([^/:?]+)/)
  return m ? m[1] : '(unknown host)'
}

async function ensureTenantAndUser(): Promise<string> {
  // Resolve by user email first (canonical demo identity).
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, DEMO_EMAIL),
    columns: { id: true, tenantId: true },
  })

  const safeTenantFields = {
    name: TENANT_NAME,
    automationPaused: true,            // LOCKED — never feels live / cannot send
    smsLiveApproved: false,            // gate stays off
    tenDlcStatus: 'not_started',       // gate stays off
    complianceBlocked: false,
    settings: { dealerPhone: DEMO_PHONE },
    businessLegalName: 'Revival Ridge Motors LLC (DEMO)',
    businessAddress: 'Saratoga Springs, Utah',
    smsSendingNumber: DEMO_PHONE,
    updatedAt: new Date(),
  }

  if (existingUser) {
    await db.update(tenants).set(safeTenantFields).where(eq(tenants.id, existingUser.tenantId))
    console.log(`  • Found ${DEMO_EMAIL} → tenant ${existingUser.tenantId} (updated identity + locked gates)`)
    return existingUser.tenantId
  }

  // Create tenant + user (used on local; on prod only if the account is absent).
  const [t] = await db.insert(tenants).values({
    slug: TENANT_SLUG,
    ...safeTenantFields,
  }).onConflictDoUpdate({ target: tenants.slug, set: safeTenantFields }).returning({ id: tenants.id })

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)
  await db.insert(users).values({
    tenantId: t.id,
    email: DEMO_EMAIL,
    passwordHash,
    name: DEMO_NAME,
    role: 'dealer',
  }).onConflictDoNothing({ target: users.email })

  console.log(`  • Created tenant ${t.id} + user ${DEMO_EMAIL} (demo password: "${DEMO_PASSWORD}")`)
  return t.id
}

async function cleanup(tenantId: string): Promise<void> {
  // Collect demo-tagged lead + batch ids for this tenant, then delete children
  // first. Scoped to demo tags so a real row in this tenant would be untouched.
  const demoLeads = await db.select({ id: leads.id })
    .from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.crmSource, DEMO_SOURCE)))
  const leadIds = demoLeads.map(r => r.id)

  const demoBatches = await db.select({ id: pilotBatches.id })
    .from(pilotBatches).where(and(eq(pilotBatches.tenantId, tenantId), eq(pilotBatches.createdBy, DEMO_SOURCE)))
  const batchIds = demoBatches.map(r => r.id)

  if (leadIds.length) {
    const demoConvos = await db.select({ id: conversations.id })
      .from(conversations).where(inArray(conversations.leadId, leadIds))
    const convoIds = demoConvos.map(r => r.id)
    if (convoIds.length) {
      await db.delete(messages).where(inArray(messages.conversationId, convoIds))
      await db.delete(conversations).where(inArray(conversations.id, convoIds))
    }
  }
  if (batchIds.length) {
    await db.delete(pilotBatchLeads).where(inArray(pilotBatchLeads.batchId, batchIds))
    await db.delete(pilotBatches).where(inArray(pilotBatches.id, batchIds))
  }
  await db.delete(optOuts).where(and(eq(optOuts.tenantId, tenantId), eq(optOuts.source, DEMO_SOURCE)))
  await db.delete(pilotLeadImports).where(and(eq(pilotLeadImports.tenantId, tenantId), eq(pilotLeadImports.crmSource, DEMO_SOURCE)))
  if (leadIds.length) await db.delete(leads).where(inArray(leads.id, leadIds))
  await db.delete(workflows).where(and(eq(workflows.tenantId, tenantId), like(workflows.key, 'demo_seed:%')))

  console.log(`  • Cleanup: removed ${leadIds.length} leads, ${batchIds.length} batches and all demo-tagged children`)
}

async function seed(tenantId: string): Promise<void> {
  // 1) Workflows (one per campaign) — inactive, not approved for live.
  const wfRows = await db.insert(workflows).values(
    CAMPAIGNS.map(c => ({
      tenantId,
      name: c.name,
      description: 'Demo campaign (seeded)',
      triggerType: 'manual' as const,
      isActive: false,
      approvedForLive: false,
      activationStatus: 'draft',
      requiresOptOutLanguage: true,
      key: c.key,
      ageBucket: c.bucket,
    })),
  ).returning({ id: workflows.id, key: workflows.key })
  const wfByKey = new Map(wfRows.map(w => [w.key as string, w.id]))

  // 2) Selected leads (promoted) + their 'selected' import rows.
  const leadValues = Array.from({ length: N_SELECTED }, (_, i) => {
    const first = pick(FIRST_NAMES, i)
    const last = pick(LAST_NAMES, i * 3 + 1)
    const vehicle = pick(TRUCKS, i)
    const inquiryDaysAgo = 14 + (i % 80)
    return {
      tenantId,
      crmSource: DEMO_SOURCE,
      crmLeadId: `demo-${i}`,
      firstName: first,
      lastName: last,
      phone: nextFakePhone(),
      email: `${first}.${last}.demo${i}@example.com`.toLowerCase(),
      vehicleOfInterest: vehicle,
      state: 'enrolled' as const,
      doNotAutomate: true,                    // ← hard automation block
      isTest: false,                          // ← counted by dashboard
      consentStatus: 'explicit',
      consentSource: 'demo_seed',
      originalInquiryAt: daysAgo(inquiryDaysAgo),
      smsConsentNotes: 'DEMO SEED DATA — not a real contact',
      metadata: { demoSeed: true, seedTag: SEED_TAG },
    }
  })
  const insertedLeads = await db.insert(leads).values(leadValues)
    .returning({ id: leads.id, phone: leads.phone, firstName: leads.firstName, vehicle: leads.vehicleOfInterest })

  await db.insert(pilotLeadImports).values(
    insertedLeads.map((l, i) => ({
      tenantId,
      firstName: l.firstName,
      lastName: pick(LAST_NAMES, i * 3 + 1),
      phoneRaw: l.phone!,
      phone: l.phone,
      vehicleOfInterest: l.vehicle,
      crmSource: DEMO_SOURCE,
      importStatus: 'selected',
      selectedForBatch: true,
      consentStatus: 'explicit',
      leadId: l.id,
      ageBucket: ['a', 'b', 'c', 'd'][i % 4],
      previewMessages: previewFor(pick(CAMPAIGNS, i).name, l.vehicle ?? 'truck'),
    })),
  )

  // 3) Import-only rows (no promoted lead): eligible / blocked / warning.
  const importOnly: Array<{ status: string; consent: string; reasons?: string[]; warns?: string[] }> = [
    ...Array.from({ length: N_ELIGIBLE }, () => ({ status: 'eligible', consent: 'explicit' })),
    ...Array.from({ length: N_BLOCKED }, () => ({ status: 'blocked', consent: 'unknown', reasons: ['Consent status is unknown — confirm opt-in before contacting'] })),
    ...Array.from({ length: N_WARNING }, () => ({ status: 'warning', consent: 'explicit', warns: ['Missing vehicle of interest — message will use a generic fallback'] })),
  ]
  await db.insert(pilotLeadImports).values(
    importOnly.map((r, i) => ({
      tenantId,
      firstName: pick(FIRST_NAMES, i * 2 + 5),
      lastName: pick(LAST_NAMES, i * 2 + 7),
      phoneRaw: nextFakePhone(),
      phone: null,
      crmSource: DEMO_SOURCE,
      importStatus: r.status,
      selectedForBatch: false,
      consentStatus: r.consent,
      blockedReasons: r.reasons ?? null,
      warnings: r.warns ?? null,
      ageBucket: null,
    })),
  )

  // 4) Campaign batches (draft/previewed) + completed batches (Deals Revived).
  const batchValues = [
    ...CAMPAIGNS.map(c => ({
      tenantId,
      workflowId: wfByKey.get(c.key)!,
      status: c.status,
      maxLeadCount: 50,
      createdBy: DEMO_SOURCE,
      createdAt: daysAgo(5),
    })),
    ...Array.from({ length: N_COMPLETED_BATCHES }, (_, i) => ({
      tenantId,
      workflowId: wfByKey.get(CAMPAIGNS[i].key)!,
      status: 'completed',
      maxLeadCount: 25,
      createdBy: DEMO_SOURCE,
      approvedBy: DEMO_SOURCE,
      approvedAt: daysAgo(40 + i),
      completedAt: daysAgo(20 + i),
      createdAt: daysAgo(45 + i),
    })),
  ]
  const insertedBatches = await db.insert(pilotBatches).values(batchValues)
    .returning({ id: pilotBatches.id, status: pilotBatches.status })

  // Attach a realistic subset of leads to each batch.
  const batchLeadValues: Array<typeof pilotBatchLeads.$inferInsert> = []
  insertedBatches.forEach((b, bi) => {
    const count = b.status === 'completed' ? 10 : 30 + (bi % 4) * 5
    for (let k = 0; k < count; k++) {
      const lead = insertedLeads[(bi * 17 + k) % insertedLeads.length]
      batchLeadValues.push({
        batchId: b.id,
        leadId: lead.id,
        approvedForSend: false,
        sendStatus: b.status === 'completed' ? 'sent' : 'pending',
        previewMessages: previewFor(pick(CAMPAIGNS, bi).name, lead.vehicle ?? 'truck'),
        eligibilityResult: ELIGIBLE_OK,
      })
    }
  })
  // De-dup (batchId, leadId) to satisfy the unique index.
  const seen = new Set<string>()
  const dedupedBatchLeads = batchLeadValues.filter(v => {
    const k = `${v.batchId}:${v.leadId}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })
  await db.insert(pilotBatchLeads).values(dedupedBatchLeads)

  // 5) Conversations + messages (historical; provider='demo_seed' = no send).
  const convoLeads = insertedLeads.slice(0, N_OPEN_CONVOS)
  const msgValues: Array<typeof messages.$inferInsert> = []
  let outboundRemaining = N_OUTBOUND_TARGET

  for (let i = 0; i < convoLeads.length; i++) {
    const lead = convoLeads[i]
    const [conv] = await db.insert(conversations).values({
      tenantId,
      leadId: lead.id,
      tenantPhone: DEMO_PHONE,
      leadPhone: lead.phone!,
      status: 'open',
      updatedAt: daysAgo(i % 14),
    }).returning({ id: conversations.id })

    const outboundThisConvo = Math.max(1, Math.round(outboundRemaining / (convoLeads.length - i)))
    for (let m = 0; m < outboundThisConvo; m++) {
      msgValues.push({
        conversationId: conv.id,
        direction: 'outbound',
        body: pick(OUTBOUND_BODIES, i + m).replace('{name}', lead.firstName ?? 'there'),
        provider: DEMO_SOURCE,
        providerMessageId: `demo-seed-${i}-${m}`,
        status: m % 5 === 0 ? 'sent' : 'delivered',
        sentAt: daysAgo((i % 14) + 1),
        deliveredAt: daysAgo(i % 14),
      })
    }
    outboundRemaining -= outboundThisConvo

    // A few of these get a realistic inbound reply (rotating examples, no STOP).
    if (i < 5) {
      msgValues.push({
        conversationId: conv.id,
        direction: 'inbound',
        body: EXAMPLE_REPLIES[i].body,
        provider: DEMO_SOURCE,
        providerMessageId: `demo-seed-in-${i}`,
        status: 'received',
      })
    }
  }

  // STOP example → opted-out conversation + opt-out row + revoked consent.
  const stopLead = insertedLeads[N_OPEN_CONVOS]
  const [stopConv] = await db.insert(conversations).values({
    tenantId, leadId: stopLead.id, tenantPhone: DEMO_PHONE, leadPhone: stopLead.phone!,
    status: 'opted_out', updatedAt: daysAgo(3),
  }).returning({ id: conversations.id })
  msgValues.push(
    { conversationId: stopConv.id, direction: 'outbound', body: pick(OUTBOUND_BODIES, 0).replace('{name}', stopLead.firstName ?? 'there'), provider: DEMO_SOURCE, providerMessageId: 'demo-seed-stop-out', status: 'delivered', sentAt: daysAgo(4), deliveredAt: daysAgo(4) },
    { conversationId: stopConv.id, direction: 'inbound',  body: 'STOP', provider: DEMO_SOURCE, providerMessageId: 'demo-seed-stop-in', status: 'received' },
  )
  await db.update(leads).set({ state: 'opted_out', consentStatus: 'revoked', doNotAutomate: true }).where(eq(leads.id, stopLead.id))
  await db.insert(optOuts).values({ tenantId, phone: stopLead.phone!, source: DEMO_SOURCE })
    .onConflictDoNothing({ target: [optOuts.tenantId, optOuts.phone] })

  await db.insert(messages).values(msgValues)

  const outboundInserted = msgValues.filter(m => m.direction === 'outbound').length
  console.log(`  • Seeded: ${insertedLeads.length} leads, ${importOnly.length} import-only rows, ${insertedBatches.length} batches, ${convoLeads.length + 1} conversations, ${msgValues.length} messages (${outboundInserted} outbound)`)
}

async function main() {
  const cleanupOnly = process.argv.includes('--cleanup')
  console.log(`\nDemo seed — Revival Ridge Motors`)
  console.log(`  DB host: ${maskedHost()}`)
  console.log(`  Mode:    ${cleanupOnly ? 'CLEANUP ONLY' : 'cleanup + seed'}\n`)

  const tenantId = await ensureTenantAndUser()
  await cleanup(tenantId)
  if (!cleanupOnly) await seed(tenantId)

  console.log(`\nDone. Tenant ${tenantId} (${DEMO_EMAIL}). Safety: automationPaused=true, smsLiveApproved=false, every lead doNotAutomate=true. No sends queued.\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

/**
 * DLR seed script — run once per environment to bootstrap:
 *   1. A tenant (dealership)
 *   2. An admin user
 *   3. A phone number (your Telnyx number)
 *   4. A default 3-step stale lead revival workflow
 *
 * Usage:
 *   npm run db:seed
 *
 * Override defaults with env vars:
 *   SEED_TENANT_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_PHONE_NUMBER
 */

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { db } from '../src/lib/db'
import {
  tenants, users, phoneNumbers, workflows, workflowSteps, leads,
} from '../src/lib/db/schema'

const TENANT_NAME    = process.env.SEED_TENANT_NAME    ?? 'Demo Dealership'
const ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    ?? 'admin@dealership.com'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'changeme123'
const PHONE_NUMBER   = process.env.SEED_PHONE_NUMBER   ?? '+15550000000'

async function seed() {
  console.log('🌱 Seeding DLR...\n')

  // ── 1. Tenant ────────────────────────────────────────────────────────────
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: TENANT_NAME,
      slug: TENANT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      settings: { staleThresholdDays: 14 },
    })
    .onConflictDoNothing()
    .returning()

  if (!tenant) {
    console.log('⚠️  Tenant already exists — skipping tenant, user, and phone number creation.')
    console.log('   (Run against a fresh DB to re-seed from scratch.)\n')
    return
  }

  console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`)

  // ── 2. Admin user ────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      passwordHash,
      name: 'Admin',
      role: 'admin',
    })
    .returning()

  console.log(`✅ Admin user: ${user.email}`)

  // ── 3. Phone number ──────────────────────────────────────────────────────
  const [phone] = await db
    .insert(phoneNumbers)
    .values({
      tenantId: tenant.id,
      number: PHONE_NUMBER,
      provider: 'telnyx',
      isActive: true,
    })
    .returning()

  console.log(`✅ Phone number: ${phone.number}`)

  // ── 4. Default workflow: 3-step stale lead revival ───────────────────────
  const [workflow] = await db
    .insert(workflows)
    .values({
      tenantId: tenant.id,
      name: '14-Day Stale Lead Revival',
      description: 'Automatically reaches out to leads inactive for 14+ days.',
      triggerType: 'stale',
      triggerConfig: { daysInactive: 14 },
      isActive: true,
    })
    .returning()

  await db.insert(workflowSteps).values([
    {
      workflowId: workflow.id,
      position: 1,
      type: 'send_sms',
      config: {
        type: 'send_sms',
        template:
          'Hi {{firstName}}, this is {{dealershipName}}. We noticed you were recently looking for a {{vehicleOfInterest}}. Still interested? Reply STOP to opt out.',
        delayHours: 0,
      },
    },
    {
      workflowId: workflow.id,
      position: 2,
      type: 'condition',
      config: {
        type: 'condition',
        field: 'lead.responded',
        operator: 'eq',
        value: 'true',
        ifTrue: 'stop',    // they replied — stop workflow, keep in inbox
        ifFalse: 'continue',
      },
    },
    {
      workflowId: workflow.id,
      position: 3,
      type: 'send_sms',
      config: {
        type: 'send_sms',
        template:
          'Hi {{firstName}}, just following up from {{dealershipName}}. We have some great options available this week. Want to come in for a test drive? Reply STOP to opt out.',
        delayHours: 72,
      },
    },
    {
      workflowId: workflow.id,
      position: 4,
      type: 'condition',
      config: {
        type: 'condition',
        field: 'lead.responded',
        operator: 'eq',
        value: 'true',
        ifTrue: 'stop',
        ifFalse: 'continue',
      },
    },
    {
      workflowId: workflow.id,
      position: 5,
      type: 'send_sms',
      config: {
        type: 'send_sms',
        template:
          'Last message from us, {{firstName}}. We have a limited-time offer this week only at {{dealershipName}}. Give us a call anytime — we\'d love to help. Reply STOP to opt out.',
        delayHours: 72,
      },
    },
  ])

  console.log(`✅ Workflow: "${workflow.name}" (${workflow.id}) — 5 steps`)

  // ── 5. Realistic stale leads ─────────────────────────────────────────────
  // 8 leads spread across 7–21 days inactive, different vehicles + salespeople.
  // lastCrmActivityAt is set in the past so the stale-detection worker can
  // immediately find and enroll them.
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

  const staleLeadRows = [
    {
      tenantId: tenant.id,
      crmSource: 'vinsolutions',
      crmLeadId: 'VS-10001',
      firstName: 'Marcus',
      lastName: 'Delgado',
      phone: '+15550101001',
      email: 'marcus.delgado@email.com',
      vehicleOfInterest: '2024 Ford F-150 XLT',
      salespersonName: 'Jake Monroe',
      state: 'stale' as const,
      staleAt: daysAgo(15),
      lastCrmActivityAt: daysAgo(15),
    },
    {
      tenantId: tenant.id,
      crmSource: 'vinsolutions',
      crmLeadId: 'VS-10002',
      firstName: 'Priya',
      lastName: 'Nair',
      phone: '+15550101002',
      email: 'priya.nair@email.com',
      vehicleOfInterest: '2024 Honda Accord Sport',
      salespersonName: 'Sara Whitfield',
      state: 'stale' as const,
      staleAt: daysAgo(21),
      lastCrmActivityAt: daysAgo(21),
    },
    {
      tenantId: tenant.id,
      crmSource: 'dealersocket',
      crmLeadId: 'DS-20045',
      firstName: 'Tyler',
      lastName: 'Hutchins',
      phone: '+15550101003',
      email: 'tyler.h@email.com',
      vehicleOfInterest: '2023 Toyota Camry SE',
      salespersonName: 'Jake Monroe',
      state: 'stale' as const,
      staleAt: daysAgo(18),
      lastCrmActivityAt: daysAgo(18),
    },
    {
      tenantId: tenant.id,
      crmSource: 'dealersocket',
      crmLeadId: 'DS-20046',
      firstName: 'Angela',
      lastName: 'Reyes',
      phone: '+15550101004',
      email: 'angela.reyes@email.com',
      vehicleOfInterest: '2024 Chevrolet Silverado 1500',
      salespersonName: 'Sara Whitfield',
      state: 'stale' as const,
      staleAt: daysAgo(7),
      lastCrmActivityAt: daysAgo(7),
    },
    {
      tenantId: tenant.id,
      crmSource: 'csv',
      crmLeadId: 'CSV-001',
      firstName: 'Derek',
      lastName: 'Kim',
      phone: '+15550101005',
      email: 'derek.kim@email.com',
      vehicleOfInterest: '2024 BMW 3 Series',
      salespersonName: 'Tom Brennan',
      state: 'stale' as const,
      staleAt: daysAgo(14),
      lastCrmActivityAt: daysAgo(14),
    },
    {
      tenantId: tenant.id,
      crmSource: 'csv',
      crmLeadId: 'CSV-002',
      firstName: 'Sandra',
      lastName: 'Okonkwo',
      phone: '+15550101006',
      email: 'sandra.o@email.com',
      vehicleOfInterest: '2023 Jeep Grand Cherokee',
      salespersonName: 'Tom Brennan',
      state: 'stale' as const,
      staleAt: daysAgo(19),
      lastCrmActivityAt: daysAgo(19),
    },
    {
      tenantId: tenant.id,
      crmSource: 'vinsolutions',
      crmLeadId: 'VS-10008',
      firstName: 'Carlos',
      lastName: 'Mendez',
      phone: '+15550101007',
      email: 'carlos.mendez@email.com',
      vehicleOfInterest: '2024 Tesla Model 3',
      salespersonName: 'Jake Monroe',
      state: 'stale' as const,
      staleAt: daysAgo(16),
      lastCrmActivityAt: daysAgo(16),
    },
    {
      tenantId: tenant.id,
      crmSource: 'vinsolutions',
      crmLeadId: 'VS-10009',
      firstName: 'Rachel',
      lastName: 'Bloom',
      phone: '+15550101008',
      email: 'rachel.bloom@email.com',
      vehicleOfInterest: '2024 Hyundai Tucson SEL',
      salespersonName: 'Sara Whitfield',
      state: 'stale' as const,
      staleAt: daysAgo(9),
      lastCrmActivityAt: daysAgo(9),
    },
  ]

  await db.insert(leads).values(staleLeadRows)
  console.log(`✅ Stale leads: 8 inserted (7–21 days inactive)`)

  console.log('\n✅ Seed complete.\n')
  console.log('Next steps:')
  console.log(`  1. Set TELNYX_API_KEY and TELNYX_PUBLIC_KEY in .env`)
  console.log(`  2. Point your Telnyx number (${PHONE_NUMBER}) webhook to: https://your-domain/api/webhooks/telnyx`)
  console.log(`  3. npm run dev  (Next.js app)`)
  console.log(`  4. npm run worker  (BullMQ worker, separate terminal)`)
  console.log(`  5. Log in at http://localhost:3000/login with ${ADMIN_EMAIL}`)
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => process.exit(0))

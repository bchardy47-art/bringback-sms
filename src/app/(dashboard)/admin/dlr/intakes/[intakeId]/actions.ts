'use server'

import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { eq, and, gt, count } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { dealerIntakes, tenants, users, workflows, pilotLeadImports, pilotBatches } from '@/lib/db/schema'

async function requireSession() {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Unauthorized')
  return session
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 50)
}

// ── Mark 10DLC submitted to TCR ───────────────────────────────────────────────

export async function mark10dlcPending(intakeId: string) {
  await requireSession()
  await db
    .update(dealerIntakes)
    .set({ launchStatus: '10dlc_pending', updatedAt: new Date() })
    .where(eq(dealerIntakes.id, intakeId))
  revalidatePath(`/admin/dlr/intakes/${intakeId}`)
}

// ── Mark 10DLC approved ───────────────────────────────────────────────────────

export async function mark10dlcApproved(intakeId: string) {
  await requireSession()

  const intake = await db.query.dealerIntakes.findFirst({
    where: eq(dealerIntakes.id, intakeId),
  })
  if (!intake) throw new Error('Intake not found')

  await db
    .update(dealerIntakes)
    .set({ launchStatus: '10dlc_approved', updatedAt: new Date() })
    .where(eq(dealerIntakes.id, intakeId))

  // If the tenant already exists, update its 10DLC status too
  if (intake.tenantId) {
    await db
      .update(tenants)
      .set({
        tenDlcStatus: 'approved',
        tenDlcApprovedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, intake.tenantId))
  }

  revalidatePath(`/admin/dlr/intakes/${intakeId}`)
}

// ── Provision tenant from intake ──────────────────────────────────────────────
//
// Creates the tenant row (pre-filled from intake) and an admin user.
// Returns the generated temp password — shown ONCE in the UI.
// The admin copies and sends it to the dealer out-of-band.

export async function provisionTenant(intakeId: string): Promise<{
  tenantId: string
  adminEmail: string
  tempPassword: string
  loginUrl: string
}> {
  const session = await requireSession()

  const intake = await db.query.dealerIntakes.findFirst({
    where: eq(dealerIntakes.id, intakeId),
  })
  if (!intake) throw new Error('Intake not found')
  if (intake.tenantId) throw new Error('Tenant already provisioned for this intake')

  const name        = intake.dealershipName ?? 'New Dealership'
  const baseSlug    = generateSlug(name)
  const slug        = `${baseSlug}-${randomBytes(3).toString('hex')}`  // suffix for uniqueness

  // Create tenant
  const [tenant] = await db
    .insert(tenants)
    .values({
      name,
      slug,
      // Pre-fill all identity + compliance fields from intake
      businessLegalName:      intake.businessLegalName ?? undefined,
      ein:                    intake.ein ?? undefined,
      businessAddress:        intake.businessAddress ?? undefined,
      businessWebsite:        intake.businessWebsite ?? undefined,
      consentExplanation:     intake.consentExplanation ?? undefined,
      leadSourceExplanation:  intake.leadSourceExplanation ?? undefined,
      expectedMonthlyVolume:  intake.expectedMonthlyVolume ?? undefined,
      tenDlcSampleMessages:   [intake.sampleMessage1, intake.sampleMessage2].filter(Boolean) as string[],
      // Compliance status
      tenDlcStatus:           intake.launchStatus === '10dlc_approved' ? 'approved' : 'not_started',
      settings:               {
        dealerPhone: intake.storePhone ?? undefined,
      },
    })
    .returning({ id: tenants.id })

  // Generate a temp password — shown once to admin, never stored in plaintext
  const tempPassword = randomBytes(10).toString('base64url')
  const passwordHash = await bcrypt.hash(tempPassword, 10)

  const adminEmail = intake.primaryContactEmail ?? `admin@${slug}.dlr`

  // Create admin user
  await db.insert(users).values({
    tenantId: tenant.id,
    email:    adminEmail,
    name:     intake.primaryContactName ?? name,
    role:     'admin',
    phone:    intake.alertPhone ?? undefined,
    passwordHash,
  })

  // Update intake with linked tenant
  await db
    .update(dealerIntakes)
    .set({
      tenantId:      tenant.id,
      launchStatus:  'provisioned',
      provisionedAt: new Date(),
      provisionedBy: session.user.email,
      updatedAt:     new Date(),
    })
    .where(eq(dealerIntakes.id, intakeId))

  revalidatePath(`/admin/dlr/intakes/${intakeId}`)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.dlrrevival.com'

  return {
    tenantId:    tenant.id,
    adminEmail,
    tempPassword,
    loginUrl:    `${appUrl}/login`,
  }
}

// ── Save admin notes ──────────────────────────────────────────────────────────

export async function saveAdminNotes(intakeId: string, notes: string) {
  await requireSession()
  await db
    .update(dealerIntakes)
    .set({ adminNotes: notes, updatedAt: new Date() })
    .where(eq(dealerIntakes.id, intakeId))
  revalidatePath(`/admin/dlr/intakes/${intakeId}`)
}

// ── Fetch extras needed for checklist ────────────────────────────────────────

export async function getChecklistExtras(tenantId: string | null) {
  if (!tenantId) return { workflowApproved: false, pilotImportsExist: false, pilotCompleted: false }

  const [wf, pi, pb] = await Promise.all([
    db
      .select({ c: count() })
      .from(workflows)
      .where(and(eq(workflows.tenantId, tenantId), eq(workflows.approvedForLive, true))),
    db
      .select({ c: count() })
      .from(pilotLeadImports)
      .where(eq(pilotLeadImports.tenantId, tenantId)),
    db
      .select({ c: count() })
      .from(pilotBatches)
      .where(and(eq(pilotBatches.tenantId, tenantId), eq(pilotBatches.status, 'completed'))),
  ])

  return {
    workflowApproved:   (wf[0]?.c ?? 0) > 0,
    pilotImportsExist:  (pi[0]?.c ?? 0) > 0,
    pilotCompleted:     (pb[0]?.c ?? 0) > 0,
  }
}

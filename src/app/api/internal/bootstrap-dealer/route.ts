import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'

export const runtime = 'nodejs'

const TARGET_EMAIL = 'demo@dlr-sms.com'
const TARGET_NAME = 'Demo Dealer'

type SafeTenant = {
  id: string
  name: string
  slug: string
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function pickTenant(list: SafeTenant[]): SafeTenant | null {
  const priorities = ['Test Motors Honda', 'Demo Dealership']

  for (const target of priorities) {
    const exact = list.find((tenant) => normalize(tenant.name) === normalize(target))
    if (exact) return exact

    const contains = list.find((tenant) => normalize(tenant.name).includes(normalize(target)))
    if (contains) return contains
  }

  return null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.BOOTSTRAP_ADMIN_SECRET
  if (!secret) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const provided = req.headers.get('x-bootstrap-secret')
  if (!provided || provided !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tenantList = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .orderBy(tenants.name)

  const selectedTenant = pickTenant(tenantList)
  if (!selectedTenant) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No matching demo tenant found',
        availableTenants: tenantList,
      },
      { status: 409 },
    )
  }

  const temporaryPassword = randomBytes(24).toString('base64url')
  const passwordHash = await bcrypt.hash(temporaryPassword, 10)

  const existing = await db.query.users.findFirst({
    where: eq(users.email, TARGET_EMAIL),
    columns: { id: true },
  })

  let action: 'created' | 'updated'

  if (existing) {
    await db
      .update(users)
      .set({
        tenantId: selectedTenant.id,
        email: TARGET_EMAIL,
        name: TARGET_NAME,
        role: 'dealer',
        passwordHash,
      })
      .where(eq(users.id, existing.id))
    action = 'updated'
  } else {
    await db.insert(users).values({
      tenantId: selectedTenant.id,
      email: TARGET_EMAIL,
      passwordHash,
      name: TARGET_NAME,
      role: 'dealer',
    })
    action = 'created'
  }

  return NextResponse.json({
    ok: true,
    email: TARGET_EMAIL,
    action,
    role: 'dealer',
    tenant: selectedTenant,
    temporaryPassword,
  })
}

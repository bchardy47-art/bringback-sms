import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

export const runtime = 'nodejs'

const TARGET_EMAIL = 'brian@dlr-sms.com'
const TARGET_NAME = 'Brian Hardy'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.BOOTSTRAP_ADMIN_SECRET
  if (!secret) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const provided = req.headers.get('x-bootstrap-secret')
  if (!provided || provided !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const temporaryPassword = randomBytes(24).toString('base64url')
  const passwordHash = await bcrypt.hash(temporaryPassword, 10)

  const existing = await db.query.users.findFirst({
    where: eq(users.email, TARGET_EMAIL),
    columns: {
      id: true,
      email: true,
      tenantId: true,
    },
  })

  let action: 'created' | 'updated'

  if (existing) {
    await db
      .update(users)
      .set({
        name: TARGET_NAME,
        role: 'admin',
        passwordHash,
      })
      .where(eq(users.id, existing.id))
    action = 'updated'
  } else {
    const existingAdmin = await db.query.users.findFirst({
      where: eq(users.role, 'admin'),
      columns: { tenantId: true },
    })

    const fallbackTenant = existingAdmin
      ? null
      : await db.query.tenants.findFirst({ columns: { id: true } })

    const tenantId = existingAdmin?.tenantId ?? fallbackTenant?.id
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant available for admin bootstrap' }, { status: 409 })
    }

    await db.insert(users).values({
      tenantId,
      email: TARGET_EMAIL,
      passwordHash,
      name: TARGET_NAME,
      role: 'admin',
    })
    action = 'created'
  }

  return NextResponse.json({
    email: TARGET_EMAIL,
    action,
    role: 'admin',
    temporaryPassword,
  })
}

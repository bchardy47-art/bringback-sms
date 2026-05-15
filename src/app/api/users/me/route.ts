import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'

const UpdateMeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{6,14}$/, 'Must be a valid phone number (e.g. +18015551234)')
    .nullable()
    .optional(),
})

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, name: true, email: true, phone: true, role: true, tenantId: true },
  })

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ user })
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const body = await req.json()
  const parsed = UpdateMeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if ('phone' in parsed.data) updates.phone = parsed.data.phone ?? null

  await db.update(users).set(updates).where(eq(users.id, session.user.id))

  const updated = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, name: true, email: true, phone: true, role: true, tenantId: true },
  })

  return NextResponse.json({ user: updated })
}

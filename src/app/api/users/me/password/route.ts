import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { requireAuth } from '@/lib/api/requireAuth'

// Minimum standard: 10+ chars, at least one letter and one digit.
// Lightweight on purpose — we're guarding against trivial choices, not
// trying to be a full password policy engine.
const newPasswordRule = z
  .string()
  .min(10, 'New password must be at least 10 characters')
  .max(200, 'New password is too long')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), {
    message: 'New password must include at least one letter and one number',
  })

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: newPasswordRule,
    confirmPassword: z.string().min(1, 'Confirm password is required'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'New password and confirmation do not match',
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current password',
  })

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ChangePasswordSchema.safeParse(body)
  if (!parsed.success) {
    // Surface only Zod's structured errors — never echo the submitted values.
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }
  const { currentPassword, newPassword } = parsed.data

  const userRow = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, passwordHash: true },
  })
  if (!userRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ok = await bcrypt.compare(currentPassword, userRow.passwordHash)
  if (!ok) {
    return NextResponse.json(
      { error: { fieldErrors: { currentPassword: ['Current password is incorrect'] } } },
      { status: 422 },
    )
  }

  const newHash = await bcrypt.hash(newPassword, 10)
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userRow.id))

  return NextResponse.json({ ok: true })
}

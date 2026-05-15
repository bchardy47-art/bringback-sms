'use server'

import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { dealerInvites, users } from '@/lib/db/schema'

type ClaimArgs = {
  token:    string
  name:     string
  email:    string
  password: string
}

export async function claimDealerInvite({ token, name, email, password }: ClaimArgs) {
  // Validate inputs
  if (!name.trim())    throw new Error('Name is required')
  if (!email.trim())   throw new Error('Email is required')
  if (!password)       throw new Error('Password is required')
  if (password.length < 8) throw new Error('Password must be at least 8 characters')

  // Look up invite
  const invite = await db.query.dealerInvites.findFirst({
    where: eq(dealerInvites.token, token),
  })

  if (!invite)      throw new Error('Invalid invite link')
  if (invite.used)  throw new Error('This invite has already been used')
  if (new Date() > new Date(invite.expiresAt)) {
    throw new Error('This invite has expired — ask your DLR contact for a new one')
  }

  // Check if email is already registered
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase().trim()),
  })
  if (existing) {
    throw new Error('An account with that email already exists — try signing in instead')
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12)

  // Create user with dealer role, scoped to invite's tenant
  const [newUser] = await db
    .insert(users)
    .values({
      tenantId:     invite.tenantId,
      email:        email.toLowerCase().trim(),
      passwordHash,
      name:         name.trim(),
      role:         'dealer',
    })
    .returning({ id: users.id })

  // Mark invite as used
  await db
    .update(dealerInvites)
    .set({ used: true, usedBy: newUser.id })
    .where(eq(dealerInvites.token, token))

  // Redirect to login — user must sign in fresh
  redirect('/login?invited=1')
}

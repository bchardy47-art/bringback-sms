'use server'

import { randomBytes } from 'crypto'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'

export async function generateIntakeLink(formData: FormData) {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Unauthorized')

  const dealershipName = (formData.get('dealershipName') as string | null)?.trim() ?? ''
  if (!dealershipName) throw new Error('Dealership name is required')

  const token = randomBytes(20).toString('hex')

  const [intake] = await db
    .insert(dealerIntakes)
    .values({
      token,
      dealershipName,
      launchStatus: 'submitted',
    })
    .returning({ id: dealerIntakes.id })

  redirect(`/admin/dlr/intakes/${intake.id}`)
}

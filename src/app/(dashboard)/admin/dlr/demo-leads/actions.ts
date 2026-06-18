'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoLeads } from '@/lib/db/schema'
import { requireAdminAction } from '@/lib/api/requireAuth'

export async function markContacted(id: string) {
  await requireAdminAction()
  await db
    .update(demoLeads)
    .set({ status: 'contacted', lastContactedAt: new Date(), updatedAt: new Date() })
    .where(eq(demoLeads.id, id))
  revalidatePath('/admin/dlr/demo-leads')
}

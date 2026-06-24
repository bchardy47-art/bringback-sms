'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { adminNotes } from '@/lib/db/schema'
import { assertAdmin } from '@/lib/admin/access'
import { pauseTenantAutomation, resumeTenantAutomation } from '@/lib/admin/dlr-queries'

// Admin-only per-dealer notes. PRIVACY: free text only — never auto-capture SMS
// bodies or lead phone numbers (the form is a plain textarea Brian types into).
export async function addAdminNoteAction(formData: FormData) {
  const actor = await assertAdmin()
  const tenantId = String(formData.get('tenantId') ?? '')
  const body = String(formData.get('body') ?? '').trim()
  if (!tenantId || !body) return
  await db.insert(adminNotes).values({
    tenantId,
    authorUserId: /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null,
    authorEmail: actor.email,
    body,
  })
  revalidatePath(`/admin/dealers/${tenantId}`)
}

// Reuse the existing safe pause/resume mechanism (tenant kill switch).
export async function pauseDealerAction(formData: FormData) {
  await assertAdmin()
  const tenantId = String(formData.get('tenantId') ?? '')
  if (!tenantId) return
  await pauseTenantAutomation(tenantId)
  revalidatePath(`/admin/dealers/${tenantId}`)
}

export async function resumeDealerAction(formData: FormData) {
  await assertAdmin()
  const tenantId = String(formData.get('tenantId') ?? '')
  if (!tenantId) return
  await resumeTenantAutomation(tenantId)
  revalidatePath(`/admin/dealers/${tenantId}`)
}

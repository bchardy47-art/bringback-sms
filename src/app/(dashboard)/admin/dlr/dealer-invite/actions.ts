'use server'

import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { requireAdminAction } from '@/lib/api/requireAuth'
import { db } from '@/lib/db'
import { dealerInvites, tenants } from '@/lib/db/schema'
import {
  sendDealerInviteEmail,
  type DealerInviteEmailResult,
} from '@/lib/intake/dealer-invite-email'

export type GenerateDealerInviteResult = {
  token:       string
  expiresAt:   Date
  inviteUrl:   string
  emailResult: DealerInviteEmailResult
}

/**
 * Generate a one-time dealer invite link for a given tenant.
 *
 * The link is valid for 7 days. If a dealer email is provided AND SMTP
 * is configured on this environment, the invite is also delivered by
 * email. The email-send result is returned alongside the link so the
 * admin UI can show honest copy ("emailed to X" vs. "SMTP not configured
 * — copy the link manually") instead of a generic success state.
 *
 * The invite row is created regardless of email outcome — admins can
 * always fall back to copying the link.
 */
export async function generateDealerInvite(
  tenantId: string,
  email?: string,
): Promise<GenerateDealerInviteResult> {
  await requireAdminAction()
  if (!tenantId) throw new Error('tenantId is required')

  const token     = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await db.insert(dealerInvites).values({
    tenantId,
    token,
    email: email ?? null,
    expiresAt,
  })

  // Canonical app URL for the emailed link. window.location.origin would
  // be the admin's browser, which is not safe to embed in a customer-
  // facing email. Falls through to the production host as a last resort.
  const baseUrl =
    process.env.NEXTAUTH_URL ??
    process.env.APP_URL ??
    'https://dlr-sms.com'
  const inviteUrl = `${baseUrl.replace(/\/$/, '')}/dealer-invite/${token}`

  const [tenantRow] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  const dealershipName = tenantRow?.name ?? 'your dealership'

  const emailResult = await sendDealerInviteEmail({
    recipientEmail: email ?? null,
    dealershipName,
    inviteUrl,
    expiresAt,
  })

  return { token, expiresAt, inviteUrl, emailResult }
}

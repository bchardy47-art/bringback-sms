'use server'

/**
 * Server actions for the Forgot Password / Reset Password flow.
 *
 * Security invariants enforced here:
 *   - requestPasswordReset always returns the same generic message regardless
 *     of whether the email exists (prevents email enumeration).
 *   - Only the SHA-256 hash of the raw token is written to the database.
 *   - resetPassword validates expiry AND used_at before accepting the token.
 *   - New passwords are hashed with bcrypt at 10 rounds (same as sign-up).
 *   - No role changes, no SMS, no admin privilege escalation.
 */

import { randomBytes, createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import { eq, and, gt, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, passwordResetTokens } from '@/lib/db/schema'
import { sendResetPasswordEmail } from '@/lib/email/reset-password-email'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ForgotPasswordResult =
  | { ok: true }
  | { ok: false; error: string }

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Action: request a password reset link ─────────────────────────────────────

/**
 * Accepts an email address. If a matching user exists, generates a reset token
 * and sends it. Always returns { ok: true } — callers MUST NOT reveal whether
 * the email is registered.
 */
export async function requestPasswordReset(
  email: string,
): Promise<ForgotPasswordResult> {
  // Normalise input.
  const normEmail = (email ?? '').trim().toLowerCase()
  if (!normEmail) return { ok: true } // treat empty as no-op

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, normEmail),
      columns: { id: true, email: true },
    })

    // If no user, return early — same response as success to avoid enumeration.
    if (!user) return { ok: true }

    // Generate 32 cryptographically random bytes → 64-char hex string.
    const rawToken  = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 60 minutes

    await db.insert(passwordResetTokens).values({
      userId:    user.id,
      tokenHash,
      expiresAt,
    })

    // Base URL for the reset link. NEXTAUTH_URL must be the public origin in
    // production (e.g. https://dlr-sms.com) or the emailed link points at
    // localhost and is unusable — even when SMTP delivery itself succeeds.
    const rawBase = process.env.NEXTAUTH_URL ?? process.env.APP_URL
    if (!rawBase && process.env.NODE_ENV === 'production') {
      console.error(
        '[requestPasswordReset] NEXTAUTH_URL/APP_URL is not set in production — ' +
          'reset links will point at localhost and be unusable. Set NEXTAUTH_URL ' +
          'to the public origin (e.g. https://dlr-sms.com).',
      )
    }
    const baseUrl  = (rawBase ?? 'http://localhost:3000').replace(/\/$/, '')
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`

    // Fire-and-forget — email failure must not surface as a user-visible error
    // (it would reveal whether the account exists).
    sendResetPasswordEmail({
      recipientEmail: user.email,
      resetUrl,
      expiresAt,
    }).catch((err) =>
      console.error('[requestPasswordReset] email send threw unexpectedly:', err),
    )
  } catch (err) {
    // Log server-side but return the same generic success to the client.
    console.error('[requestPasswordReset] unexpected error:', err)
  }

  return { ok: true }
}

// ── Action: exchange token for a new password ─────────────────────────────────

const INVALID_TOKEN_MSG =
  'This reset link is invalid or has expired. Please request a new one.'

/**
 * Validates the raw token from the URL, then updates the user's password hash
 * and marks the token as used. All in a single transaction.
 */
export async function resetPassword(
  rawToken:        string,
  newPassword:     string,
  confirmPassword: string,
): Promise<ResetPasswordResult> {
  // ── Input validation ───────────────────────────────────────────────────────

  if (!rawToken?.trim()) {
    return { ok: false, error: INVALID_TOKEN_MSG }
  }

  // Mirror the in-app change-password rule (src/app/api/users/me/password):
  // 10+ chars with at least one letter and one number. Keeps both password
  // entry points on one standard so a reset can't set a weaker password.
  if (!newPassword || newPassword.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters.' }
  }

  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return { ok: false, error: 'Password must include at least one letter and one number.' }
  }

  if (newPassword !== confirmPassword) {
    return { ok: false, error: 'Passwords do not match.' }
  }

  // ── Token lookup ───────────────────────────────────────────────────────────

  const tokenHash = createHash('sha256').update(rawToken.trim()).digest('hex')

  let tokenRow: { id: string; userId: string } | undefined

  try {
    tokenRow = await db.query.passwordResetTokens.findFirst({
      where: and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, new Date()),
        isNull(passwordResetTokens.usedAt),
      ),
      columns: { id: true, userId: true },
    })
  } catch (err) {
    console.error('[resetPassword] token lookup failed:', err)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }

  if (!tokenRow) {
    return { ok: false, error: INVALID_TOKEN_MSG }
  }

  // ── Update password + mark token used (atomic transaction) ─────────────────

  try {
    const newHash = await bcrypt.hash(newPassword, 10)

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: newHash })
        .where(eq(users.id, tokenRow!.userId))

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, tokenRow!.id))
    })
  } catch (err) {
    console.error('[resetPassword] transaction failed:', err)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }

  return { ok: true }
}

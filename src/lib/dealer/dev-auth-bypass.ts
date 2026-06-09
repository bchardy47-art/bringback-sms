/**
 * dev-auth-bypass — LOCAL VISUAL QA ONLY
 *
 * Lets a developer load the dealer surfaces (Dashboard, Upload Leads,
 * Campaigns, Inbox) without typing the demo dealer's credentials by
 * substituting a synthetic NextAuth session for the first dealer user
 * found in the database.
 *
 * **This is for local visual QA of the redesign — it never runs in
 * production builds.** Three independent gates have to all line up
 * before the bypass activates:
 *
 *   1. `NODE_ENV !== 'production'` (hard gate; flips off the moment
 *      the app is built with `next build && next start`)
 *   2. `process.env.DLR_DEV_AUTH_BYPASS === 'true'` (opt-in env flag,
 *      checked at request time, not at module-load time)
 *   3. There is no real NextAuth session on the request — if the
 *      developer is already signed in, the real session always wins
 *      and the synthetic one is never constructed.
 *
 * The bypass:
 *   - **DOES NOT** touch billing, compliance gates, permission checks,
 *     or any API route handler. Only the dealer-page server components
 *     (`(dealer)/**`) call `getDealerSession()`; every other surface
 *     keeps reading `getServerSession(authOptions)` directly. This
 *     means an action triggered by a button on a bypassed page (form
 *     POST, fetch call) will go through the normal auth pipeline and
 *     401 without a real cookie — that's intentional, the bypass is
 *     read-only visual QA, not a "log in as Janet" backdoor.
 *
 *   - Returns the existing real session if one exists. Bypass only
 *     fires when there's nothing to fall back on.
 *
 *   - Looks up the demo dealer at request time so the UI reflects any
 *     edits to the tenant/user (e.g. dealership rename) without
 *     restarting the dev server.
 *
 * Production proof:
 *   - `if (process.env.NODE_ENV === 'production') return real session`
 *     is the first thing this function does. There is no way to flip
 *     the bypass on in a production build short of editing this file.
 *
 * How to enable (local only):
 *
 *   ```bash
 *   echo 'DLR_DEV_AUTH_BYPASS=true' >> .env.local
 *   npm run dev
 *   # open http://localhost:3000/dealer/dashboard
 *   ```
 *
 *   The topbar will show a yellow "DEV AUTH BYPASS" badge so you
 *   never forget the flag is on.
 *
 * Disabling: comment the line out of `.env.local` (or set it to
 * anything other than the literal string `'true'`) and restart.
 */

import { getServerSession, type Session } from 'next-auth'
import { eq } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

/**
 * True only when the bypass *could* fire on this request — i.e. the
 * NODE_ENV gate and the env flag are both on. This does NOT mean the
 * current session was actually substituted; a real session on the
 * same request still wins. Use `getDealerSessionWithSource()` to find
 * out whether the session in front of you is real or bypassed.
 */
export function isDevAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.DLR_DEV_AUTH_BYPASS === 'true'
  )
}

/** Where a returned dealer session came from. */
export type DealerSessionSource = 'real' | 'bypass'

/**
 * Like {@link getDealerSession} but also reports whether the returned
 * session is the synthetic bypass session or a real cookie-backed one.
 * Use this in the dealer layout so the "DEV AUTH BYPASS" topbar badge
 * only lights up when the displayed session was actually substituted
 * (not whenever the env flag happens to be on).
 */
export async function getDealerSessionWithSource(): Promise<{
  session: Session | null
  source: DealerSessionSource | null
}> {
  const real = await getServerSession(authOptions)
  if (real) return { session: real, source: 'real' }
  if (process.env.NODE_ENV === 'production') return { session: null, source: null }
  if (process.env.DLR_DEV_AUTH_BYPASS !== 'true') return { session: null, source: null }

  const bypassSession = await buildBypassSession()
  if (!bypassSession) return { session: null, source: null }
  return { session: bypassSession, source: 'bypass' }
}

/**
 * Drop-in replacement for `getServerSession(authOptions)` on dealer
 * server components. Returns the real session when one exists. When
 * the dev bypass is enabled and there is no real session, returns a
 * synthetic session for the first dealer user found in the database.
 *
 * Never substitutes a session in production builds. Never substitutes
 * one when a real session already exists.
 */
export async function getDealerSession(): Promise<Session | null> {
  const real = await getServerSession(authOptions)
  if (real) return real
  if (process.env.NODE_ENV === 'production') return null
  if (process.env.DLR_DEV_AUTH_BYPASS !== 'true') return null
  return buildBypassSession()
}

/**
 * Build the synthetic bypass session by picking the first dealer user
 * in the database. Internal helper — callers should go through
 * {@link getDealerSession} or {@link getDealerSessionWithSource} so the
 * env / NODE_ENV gates run first.
 *
 * We don't seed a dealer user here. The expectation is that the local
 * DB already contains the demo dealer (Janet @ Test Motors Honda QA
 * per the project history). If there is no dealer user at all we
 * return null so the layout's redirect to /login still fires and the
 * developer sees a clear "not signed in" surface instead of a silently
 * broken page.
 */
async function buildBypassSession(): Promise<Session | null> {
  let demo: { id: string; email: string; name: string | null; tenantId: string; role: string } | undefined
  try {
    demo = await db.query.users.findFirst({
      where: eq(users.role, 'dealer'),
      columns: { id: true, email: true, name: true, tenantId: true, role: true },
    })
  } catch (err) {
    // The dealer migration (0017_dealer_role.sql) wasn't applied on this
    // local DB, so 'dealer' isn't a valid enum value and Postgres throws.
    // Surface a clear, actionable message rather than a 500 page.
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn(
        '[dlr-dev-auth-bypass] Could not query users.role="dealer" — most likely your local DB ' +
          'is missing migration 0017_dealer_role.sql. Run `npm run db:migrate` and retry. ' +
          'Underlying error: ' + (err instanceof Error ? err.message : String(err)),
      )
    }
    return null
  }
  if (!demo) {
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn(
        '[dlr-dev-auth-bypass] DLR_DEV_AUTH_BYPASS=true but no users.role="dealer" row exists. ' +
          'Create a dealer account first (e.g. via the normal admin invite flow) — ' +
          'the bypass will not synthesise one for you to avoid touching real billing/compliance state.',
      )
    }
    return null
  }

  // Shape matches what session() callback in src/lib/auth.ts produces,
  // so downstream `session.user.*` access sees the same fields it
  // would after a normal credential login.
  return {
    user: {
      id: demo.id,
      email: demo.email,
      name: demo.name ?? 'Demo Dealer',
      tenantId: demo.tenantId,
      role: demo.role,
    },
    // NextAuth's Session type expects an `expires` string. Use a
    // far-future date so middleware/route guards that check expiry
    // don't drop the synthetic session mid-render.
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  } as Session
}

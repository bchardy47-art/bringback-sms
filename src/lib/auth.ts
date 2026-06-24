import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import type { UserRole } from '@/types/next-auth'

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  // signOut points at our own in-app interstitial so a direct GET to
  // /api/auth/signout (manual URL, bookmark, browser back-button) renders
  // a branded "signing you out…" card instead of NextAuth's bare default
  // confirm form. The AccountMenu's signOut() call already bypasses this
  // by doing a JSON POST directly — this just catches the edge cases.
  pages: { signIn: '/login', signOut: '/logout' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const email = credentials.email.trim().toLowerCase()
        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        })
        if (!user) return null

        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
          role: user.role,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.tenantId = (user as { tenantId: string }).tenantId
        token.role = (user as { role: UserRole }).role
      }
      return token
    },
    session({ session, token }) {
      session.user = {
        id: token.id,
        email: token.email!,
        name: token.name!,
        tenantId: token.tenantId,
        role: token.role,
      }
      return session
    },
  },
  // First-party activity logging (best-effort; never blocks auth). No request
  // scope in events, so skip header capture. trackEvent swallows all errors.
  events: {
    async signIn({ user }) {
      const { trackEvent } = await import('@/lib/activity/track')
      await trackEvent('login_success', {
        actor: {
          id: (user as { id?: string }).id ?? null,
          email: user.email ?? null,
          role: (user as { role?: string }).role ?? null,
          tenantId: (user as { tenantId?: string }).tenantId ?? null,
        },
        skipHeaders: true,
      })
    },
    async signOut({ token }) {
      const { trackEvent } = await import('@/lib/activity/track')
      await trackEvent('logout_clicked', {
        actor: {
          id: (token?.id as string) ?? null,
          email: (token?.email as string) ?? null,
          role: (token?.role as string) ?? null,
          tenantId: (token?.tenantId as string) ?? null,
        },
        skipHeaders: true,
      })
    },
  },
}

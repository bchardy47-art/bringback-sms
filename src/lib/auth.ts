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

        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email),
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
}

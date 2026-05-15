import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const token = await getToken({ req })
  const { pathname } = req.nextUrl

  // ── /dealer/** — dealer-only ───────────────────────────────────────────────
  if (pathname.startsWith('/dealer')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    if (token.role !== 'dealer') {
      // Admins/managers/agents land on the admin dashboard
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  // ── /admin/** and /(dashboard)/** — no dealers allowed ───────────────────
  if (pathname.startsWith('/admin') || pathname.startsWith('/dashboard')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    if (token.role === 'dealer') {
      return NextResponse.redirect(new URL('/dealer/dashboard', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dealer/:path*',
    '/admin/:path*',
    '/dashboard/:path*',
  ],
}

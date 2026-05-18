import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function loginRedirect(req: NextRequest) {
  const url = new URL('/login', req.url)
  url.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.redirect(url)
}

function jsonUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
function jsonForbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Every top-level path that belongs to the team (admin/manager/agent) shell.
// Keep this list aligned with the (dashboard) route group on disk.
const TEAM_PAGE_PREFIXES = [
  '/dashboard',
  '/admin',
  '/inbox',
  '/leads',
  '/workflows',
  '/reports',
  '/settings',
]

function isTeamPage(pathname: string): boolean {
  return TEAM_PAGE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
}

export async function middleware(req: NextRequest) {
  const token = await getToken({ req })
  const { pathname } = req.nextUrl
  const isApi = pathname.startsWith('/api/')

  // ── Forced no-cache for authenticated /admin/** pages ──────────────────────
  // Repeated post-deploy verifications showed admin browser sessions getting
  // stale HTML — page document requests never reaching Caddy after a deploy.
  // The most likely culprit is an intermediate cache (browser, service worker,
  // mobile network proxy) holding the prior build's HTML. Force no-store on
  // every middleware response that could be the answer to a /admin/** page
  // request, including the auth-redirect responses, so a cached login redirect
  // can't trap a freshly-logged-in admin either.
  const isAdminPage =
    !isApi && (pathname === '/admin' || pathname.startsWith('/admin/'))

  function applyAdminNoCache(res: NextResponse): NextResponse {
    if (!isAdminPage) return res
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
    res.headers.set('Surrogate-Control', 'no-store')
    return res
  }

  // ── /api/admin/** — admin-only API surface ─────────────────────────────────
  // Defense in depth: every handler under here also calls requireAdmin,
  // but rejecting at the edge means a dealer's request never even reaches
  // a handler that might forget the check on a future route.
  if (pathname.startsWith('/api/admin')) {
    if (!token) return jsonUnauthorized()
    if (token.role !== 'admin') return jsonForbidden()
  }

  // ── /api/dealer/** — dealer-only API surface ───────────────────────────────
  if (pathname.startsWith('/api/dealer')) {
    if (!token) return jsonUnauthorized()
    if (token.role !== 'dealer') return jsonForbidden()
  }

  // ── /dealer/** — dealer-only page surface ──────────────────────────────────
  if (pathname.startsWith('/dealer')) {
    if (!token) return loginRedirect(req)
    if (token.role !== 'dealer') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  // ── Team page surface — no dealers; admins-only for /admin/**, gated by layout ──
  if (isTeamPage(pathname) && !isApi) {
    if (!token) return applyAdminNoCache(loginRedirect(req))
    if (token.role === 'dealer') {
      return applyAdminNoCache(NextResponse.redirect(new URL('/dealer/dashboard', req.url)))
    }
    // /admin/** also requires role=admin. We can do it here to avoid an
    // extra SSR roundtrip; the (dashboard)/admin layout still has the same
    // check as belt-and-suspenders.
    if (pathname.startsWith('/admin') && token.role !== 'admin') {
      return applyAdminNoCache(NextResponse.redirect(new URL('/dashboard', req.url)))
    }
    // Platform admins should land in the admin console, not the dealer-style
    // /dashboard tenant overview. Managers and agents continue to use
    // /dashboard exactly as before.
    if (
      (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) &&
      token.role === 'admin'
    ) {
      return NextResponse.redirect(new URL('/admin/dlr', req.url))
    }
  }

  return applyAdminNoCache(NextResponse.next())
}

export const config = {
  matcher: [
    // Pages
    '/dealer/:path*',
    '/admin/:path*',
    '/dashboard/:path*',
    '/inbox/:path*',
    '/leads/:path*',
    '/workflows/:path*',
    '/reports/:path*',
    '/settings/:path*',
    // APIs — role-segregated
    '/api/admin/:path*',
    '/api/dealer/:path*',
  ],
}

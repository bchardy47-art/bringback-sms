'use client'

/**
 * Sidebar tenant-card label.
 *
 * Renders the title + subtitle inside the existing sidebar dealership card.
 * For a platform admin viewing the /admin/** console, the card switches to
 * a "DLR Platform Admin" identity so it no longer looks like the admin is
 * operating inside whichever tenant their user record happens to live in.
 * For everyone else (and for admins on non-/admin pages), it keeps showing
 * the user's tenant name as before.
 *
 * This component does NOT change auth, tenant permissions, or anything
 * server-side — it is purely a visual swap. The layout still loads the
 * tenant row from the DB; this component only decides which two lines
 * of text to render.
 */

import { usePathname } from 'next/navigation'

type Props = {
  tenantName: string
  role: string | undefined
}

export function SidebarTenantLabel({ tenantName, role }: Props) {
  const pathname = usePathname() ?? ''
  const isPlatformAdmin =
    role === 'admin' &&
    (pathname === '/admin' || pathname.startsWith('/admin/'))

  const title    = isPlatformAdmin ? 'DLR Platform Admin'                 : tenantName
  const subtitle = isPlatformAdmin ? 'BCHardy LLC · Platform Operations'  : 'Dead Lead Revival'

  return (
    <>
      <p className="text-white text-sm font-bold truncate leading-tight">{title}</p>
      <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
        {subtitle}
      </p>
    </>
  )
}

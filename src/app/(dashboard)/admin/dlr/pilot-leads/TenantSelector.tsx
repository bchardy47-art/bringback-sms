'use client'

/**
 * Dropdown selector for the admin Lead Review page.
 *
 * Why this exists: /admin/dlr/pilot-leads previously hard-locked itself
 * to the signed-in admin's tenant (session.user.tenantId, which defaults
 * to the BCHardy/Demo admin tenant). Brian had no visible way to switch
 * between dealers, creating a wrong-dealer risk during pilot-batch
 * creation. This component drives a ?tenantId=<id> URL param so the
 * page's server component re-renders with the chosen dealer scoped in.
 *
 * Pure presentational + router.push — no DB access, no state outside
 * the controlled <select>. Pass the full tenants list and the current
 * selection; the component does the rest.
 */

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

type TenantOption = {
  id:   string
  name: string
  slug: string
}

export function TenantSelector({
  tenants,
  currentTenantId,
}: {
  tenants:         TenantOption[]
  currentTenantId: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    startTransition(() => {
      if (!next) {
        router.push('/admin/dlr/pilot-leads')
      } else {
        router.push(`/admin/dlr/pilot-leads?tenantId=${encodeURIComponent(next)}`)
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="lead-review-tenant"
        className="text-xs font-semibold uppercase tracking-wider text-gray-400"
      >
        Dealer
      </label>
      <select
        id="lead-review-tenant"
        value={currentTenantId ?? ''}
        onChange={handleChange}
        disabled={isPending}
        className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
      >
        <option value="">— Choose a dealer —</option>
        {tenants.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {isPending && (
        <span className="text-xs text-gray-400">Loading…</span>
      )}
    </div>
  )
}

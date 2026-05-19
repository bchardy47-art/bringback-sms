/**
 * "Dealer view" reference panel for admin surfaces.
 *
 * Lists the five dealer-facing routes (/dealer/dashboard, /dealer/import,
 * /dealer/batches, /dealer/inbox, /dealer/settings) with helper copy
 * explaining that the routes require a dealer session — clicking them
 * as admin gets bounced back to /dashboard by the dealer layout's role
 * gate. This is intentional: we don't ship impersonation in this fix.
 *
 * Used on:
 *   /admin/dlr/dealers       — once at the bottom of the page (no
 *                               per-row email; general reference).
 *   /admin/dlr/intakes/[id]  — in the sidebar, with the dealer-user
 *                               email if one was found for the tenant.
 *
 * Pure presentational — no hooks, no client state, server-component
 * compatible.
 */

const DEALER_ROUTES: ReadonlyArray<{ href: string; label: string; desc: string }> = [
  { href: '/dealer/dashboard', label: 'Dashboard',    desc: 'Setup progress, messaging-safety banner, stat cards' },
  { href: '/dealer/import',    label: 'Upload Leads', desc: 'CSV upload, lead-age detection, pilot selection' },
  { href: '/dealer/batches',   label: 'Campaigns',    desc: 'Recommended campaigns + campaign history' },
  { href: '/dealer/inbox',     label: 'Inbox',        desc: 'Conversation list, tabs, take-over flow' },
  { href: '/dealer/settings',  label: 'Settings',     desc: 'Account, billing (with recovery link), password' },
]

export function DealerViewLinks({
  dealerLoginEmail,
  tenantName,
}: {
  dealerLoginEmail?: string | null
  tenantName?:       string | null
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 md:p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Dealer view</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Dealer pages require signing in as the dealer user. Open these in
          an incognito window (or sign out first) and use the dealer&apos;s
          login to walk through what they see.
        </p>
      </div>

      {dealerLoginEmail && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">
          <span className="text-gray-500">Dealer login email{tenantName ? ` (${tenantName})` : ''}:</span>{' '}
          <span className="font-mono font-semibold text-gray-900 break-all">
            {dealerLoginEmail}
          </span>
        </div>
      )}

      <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
        {DEALER_ROUTES.map(({ href, label, desc }) => (
          <li key={href} className="flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap"
            >
              {label} →
            </a>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-mono text-gray-500 truncate">{href}</p>
              <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-gray-400">
        Clicking these while signed in as admin will redirect you to the admin
        dashboard — that&apos;s the dealer-route role gate doing its job.
      </p>
    </div>
  )
}

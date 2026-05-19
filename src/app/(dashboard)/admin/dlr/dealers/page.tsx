/**
 * /admin/dlr/dealers
 *
 * Tenant-centric dealer list. Complements /admin/dlr/intakes (which is
 * intake-row-centric): this page renders one row per tenant joined with
 * the tenant's most-recent intake so the operator can see launch status,
 * sending number, and the primary contact alongside DLR-side identity.
 *
 * Auth: gated by the parent /admin/dlr layout (admin role required).
 *
 * No client interactivity — pure RSC. Two cheap reads (tenants + intakes)
 * stitched in memory so the page stays a single round-trip.
 */

import { desc } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@/lib/db'
import { tenants, dealerIntakes } from '@/lib/db/schema'
import {
  getLaunchStatusLabel,
  getLaunchStatusColor,
} from '@/lib/intake/checklist'
import { DealerViewLinks } from '../DealerViewLinks'

// 10DLC status pill colors. Mirrors the dealer-intake checklist palette
// so the two pages don't drift from each other.
const TEN_DLC_STATUS_COLOR: Record<string, string> = {
  not_started:   'bg-gray-100 text-gray-600',
  pending:       'bg-amber-100 text-amber-700',
  approved:      'bg-emerald-100 text-emerald-700',
  rejected:      'bg-red-100 text-red-700',
  exempt:        'bg-blue-100 text-blue-700',
  dev_override:  'bg-violet-100 text-violet-700',
}

const TEN_DLC_STATUS_LABEL: Record<string, string> = {
  not_started:   'Not started',
  pending:       'Pending',
  approved:      'Approved',
  rejected:      'Rejected',
  exempt:        'Exempt',
  dev_override:  'Dev override',
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default async function DealersPage() {
  // Fetch all tenants and all intakes. Both tables are small in this app's
  // operational scale — N tenants and at most a few intakes per tenant —
  // so a single fetch + in-memory join is simpler than a window-function
  // SQL join and keeps the page resilient to tenants without intakes.
  const [tenantRows, intakeRows] = await Promise.all([
    db.select().from(tenants).orderBy(tenants.name),
    db.select().from(dealerIntakes).orderBy(desc(dealerIntakes.createdAt)),
  ])

  // Build tenantId → most-recent intake. intakeRows are already sorted
  // newest-first, so the first occurrence per tenantId wins.
  const latestIntakeByTenant = new Map<string, typeof intakeRows[number]>()
  for (const intake of intakeRows) {
    if (!intake.tenantId) continue
    if (!latestIntakeByTenant.has(intake.tenantId)) {
      latestIntakeByTenant.set(intake.tenantId, intake)
    }
  }

  return (
    <div className="min-h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
        <h1 className="text-xl font-bold text-gray-900">Dealers</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage dealership accounts, onboarding status, and dealer access.
        </p>
      </div>

      <div className="px-4 md:px-8 py-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {tenantRows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-gray-400">
              No dealerships yet. Provision the first tenant from{' '}
              <Link
                href="/admin/dlr/intakes"
                className="text-red-600 hover:text-red-700 font-semibold"
              >
                Intakes
              </Link>{' '}
              after a dealer completes onboarding.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="bg-gray-50 border-b border-gray-100"
                  >
                    {['Dealership', 'Setup', '10DLC', 'Sending number', 'Created', ''].map(h => (
                      <th
                        key={h}
                        className="px-4 md:px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tenantRows.map(tenant => {
                    const intake = latestIntakeByTenant.get(tenant.id) ?? null
                    const tenDlcKey = tenant.tenDlcStatus ?? 'not_started'
                    const tenDlcColor =
                      TEN_DLC_STATUS_COLOR[tenDlcKey] ?? TEN_DLC_STATUS_COLOR.not_started
                    const tenDlcLabel =
                      TEN_DLC_STATUS_LABEL[tenDlcKey] ?? tenDlcKey

                    return (
                      <tr
                        key={tenant.id}
                        className="hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0"
                      >
                        <td className="px-4 md:px-5 py-3.5 align-top">
                          <p className="text-sm font-semibold text-gray-900">{tenant.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{tenant.slug}</p>
                          {intake?.primaryContactEmail && (
                            <p className="text-xs text-gray-500 mt-1">
                              {intake.primaryContactName ? `${intake.primaryContactName} · ` : ''}
                              {intake.primaryContactEmail}
                            </p>
                          )}
                        </td>
                        <td className="px-4 md:px-5 py-3.5 align-top">
                          {intake ? (
                            <span
                              className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${getLaunchStatusColor(intake.launchStatus)}`}
                            >
                              {getLaunchStatusLabel(intake.launchStatus)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300 italic">
                              No intake row
                            </span>
                          )}
                        </td>
                        <td className="px-4 md:px-5 py-3.5 align-top">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${tenDlcColor}`}
                          >
                            {tenDlcLabel}
                          </span>
                          {tenant.smsLiveApproved && (
                            <span className="ml-1 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Live
                            </span>
                          )}
                          {tenant.automationPaused && (
                            <span className="ml-1 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              Paused
                            </span>
                          )}
                          {tenant.complianceBlocked && (
                            <span className="ml-1 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                              Blocked
                            </span>
                          )}
                        </td>
                        <td className="px-4 md:px-5 py-3.5 align-top text-sm text-gray-700 font-mono whitespace-nowrap">
                          {tenant.smsSendingNumber ?? <span className="text-gray-300 font-sans italic">—</span>}
                        </td>
                        <td className="px-4 md:px-5 py-3.5 align-top text-xs text-gray-400 whitespace-nowrap">
                          {fmtDate(tenant.createdAt)}
                        </td>
                        <td className="px-4 md:px-5 py-3.5 align-top text-right whitespace-nowrap">
                          {intake ? (
                            <Link
                              href={`/admin/dlr/intakes/${intake.id}`}
                              className="text-xs font-semibold text-red-600 hover:text-red-700"
                            >
                              Open command center →
                            </Link>
                          ) : (
                            <Link
                              href="/admin/dlr/intakes"
                              className="text-xs font-semibold text-gray-500 hover:text-gray-700"
                            >
                              All intakes →
                            </Link>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-gray-400">
          Showing one row per tenant.{' '}
          <Link href="/admin/dlr/intakes" className="underline hover:text-gray-600">
            Intake-centric view →
          </Link>
        </p>

        {/* "Dealer view" reference panel — quick-jump URLs for walking a
            dealer through what they see during onboarding calls. */}
        <div className="mt-6">
          <DealerViewLinks />
        </div>
      </div>
    </div>
  )
}

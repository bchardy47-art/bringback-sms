import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { leads } from '@/lib/db/schema'
import { CsvImportButton } from '@/components/leads/CsvImportButton'
import { Upload, ChevronLeft, ChevronRight } from 'lucide-react'

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',    color: 'bg-gray-100 text-gray-700' },
  stale:     { label: 'Stale',     color: 'bg-yellow-100 text-yellow-700' },
  orphaned:  { label: 'Orphaned',  color: 'bg-orange-100 text-orange-700' },
  enrolled:  { label: 'Enrolled',  color: 'bg-blue-100 text-blue-700' },
  responded: { label: 'Responded', color: 'bg-green-100 text-green-700' },
  revived:   { label: 'Revived',   color: 'bg-emerald-100 text-emerald-700' },
  exhausted: { label: 'Exhausted', color: 'bg-red-100 text-red-600' },
  converted: { label: 'Converted', color: 'bg-purple-100 text-purple-700' },
  opted_out: { label: 'Opted out', color: 'bg-gray-200 text-gray-500' },
  dead:      { label: 'Dead',      color: 'bg-gray-200 text-gray-400' },
}

const FILTER_STATES = ['stale', 'orphaned', 'enrolled', 'responded', 'revived', 'exhausted']

const AVATAR_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d']
function nameToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { state?: string; page?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const page = Math.max(1, parseInt(searchParams.page ?? '1'))
  const limit = 50
  const offset = (page - 1) * limit
  const stateFilter = searchParams.state

  const conditions = [eq(leads.tenantId, session.user.tenantId)]
  if (stateFilter && FILTER_STATES.includes(stateFilter)) {
    conditions.push(eq(leads.state, stateFilter as typeof leads.state._.data))
  }

  const rows = await db.query.leads.findMany({
    where: and(...conditions),
    orderBy: [desc(leads.updatedAt)],
    limit,
    offset,
  })

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-4 md:py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Leads</h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage and track your lead pipeline</p>
          </div>
          <CsvImportButton />
        </div>
      </div>

      <div className="px-4 md:px-8 py-4 md:py-6">
        {/* State filter tabs */}
        <div className="flex items-center gap-1.5 mb-5 flex-wrap bg-white rounded-xl border border-gray-200 p-1.5 w-fit">
          <FilterLink href="/leads" active={!stateFilter} label="All" />
          {FILTER_STATES.map((s) => (
            <FilterLink
              key={s}
              href={`/leads?state=${s}`}
              active={stateFilter === s}
              label={STATE_LABELS[s]?.label ?? s}
              color={STATE_LABELS[s]?.color}
            />
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
                {[
                  { label: 'Lead', mobile: true },
                  { label: 'Phone', mobile: false },
                  { label: 'Vehicle', mobile: false },
                  { label: 'Salesperson', mobile: false },
                  { label: 'Status', mobile: true },
                  { label: 'Last Activity', mobile: false },
                  { label: '', mobile: true },
                ].map(({ label, mobile }) => (
                  <th
                    key={label}
                    className={`px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider${mobile ? '' : ' hidden md:table-cell'}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-400">
                    No leads found.
                  </td>
                </tr>
              )}
              {rows.map((lead) => {
                const badge = STATE_LABELS[lead.state] ?? { label: lead.state, color: 'bg-gray-100 text-gray-600' }
                const initials = `${lead.firstName[0] ?? ''}${lead.lastName?.[0] ?? ''}`.toUpperCase()
                const avatarColor = nameToColor(lead.firstName)

                return (
                  <tr
                    key={lead.id}
                    className="hover:bg-gray-50 transition-colors"
                    style={{ borderBottom: '1px solid #f9fafb' }}
                  >
                    {/* Lead */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: avatarColor }}
                        >
                          {initials}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {lead.firstName} {lead.lastName}
                          </p>
                          {lead.salespersonName && (
                            <p className="text-xs text-gray-400">{lead.salespersonName}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Phone */}
                    <td className="hidden md:table-cell px-5 py-3.5 text-sm text-gray-600 font-mono">
                      {lead.phone}
                    </td>

                    {/* Vehicle */}
                    <td className="hidden md:table-cell px-5 py-3.5 text-sm text-gray-500 max-w-[160px] truncate">
                      {lead.vehicleOfInterest ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Salesperson */}
                    <td className="hidden md:table-cell px-5 py-3.5 text-sm text-gray-500">
                      {lead.salespersonName ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>

                    {/* Last Activity */}
                    <td className="hidden md:table-cell px-5 py-3.5 text-xs text-gray-400">
                      {lead.lastCrmActivityAt
                        ? new Date(lead.lastCrmActivityAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : <span className="text-gray-300">—</span>}
                    </td>

                    {/* Action */}
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-xs font-semibold text-red-600 hover:text-red-700 transition-colors"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {(page > 1 || rows.length === limit) && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Page {page} · {rows.length} leads shown
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/leads?${stateFilter ? `state=${stateFilter}&` : ''}page=${page - 1}`}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <ChevronLeft size={14} /> Previous
                </Link>
              )}
              {rows.length === limit && (
                <Link
                  href={`/leads?${stateFilter ? `state=${stateFilter}&` : ''}page=${page + 1}`}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Next <ChevronRight size={14} />
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterLink({
  href,
  active,
  label,
  color,
}: {
  href: string
  active: boolean
  label: string
  color?: string
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        active
          ? 'bg-gray-900 text-white shadow-sm'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      {label}
    </Link>
  )
}

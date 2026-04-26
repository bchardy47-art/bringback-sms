import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, desc, eq, inArray } from 'drizzle-orm'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { leads } from '@/lib/db/schema'
import { CsvImportButton } from '@/components/leads/CsvImportButton'

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',    color: 'bg-gray-100 text-gray-700' },
  stale:     { label: 'Stale',     color: 'bg-yellow-100 text-yellow-800' },
  orphaned:  { label: 'Orphaned',  color: 'bg-orange-100 text-orange-800' },
  enrolled:  { label: 'Enrolled',  color: 'bg-blue-100 text-blue-800' },
  responded: { label: 'Responded', color: 'bg-green-100 text-green-800' },
  revived:   { label: 'Revived',   color: 'bg-emerald-100 text-emerald-800' },
  exhausted: { label: 'Exhausted', color: 'bg-red-100 text-red-700' },
  converted: { label: 'Converted', color: 'bg-purple-100 text-purple-800' },
  opted_out: { label: 'Opted out', color: 'bg-gray-200 text-gray-500' },
  dead:      { label: 'Dead',      color: 'bg-gray-200 text-gray-400' },
}

const FILTER_STATES = ['stale', 'orphaned', 'enrolled', 'responded', 'revived', 'exhausted']

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
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Leads</h1>
        <CsvImportButton />
      </div>

      {/* State filter tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        <FilterLink href="/leads" active={!stateFilter} label="All" />
        {FILTER_STATES.map((s) => (
          <FilterLink
            key={s}
            href={`/leads?state=${s}`}
            active={stateFilter === s}
            label={STATE_LABELS[s]?.label ?? s}
          />
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Name', 'Phone', 'Vehicle', 'Salesperson', 'State', 'Last Activity', ''].map(
                (h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                  No leads found.
                </td>
              </tr>
            )}
            {rows.map((lead) => {
              const badge = STATE_LABELS[lead.state] ?? { label: lead.state, color: 'bg-gray-100 text-gray-600' }
              return (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {lead.firstName} {lead.lastName}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.phone}</td>
                  <td className="px-4 py-3 text-gray-500">{lead.vehicleOfInterest ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{lead.salespersonName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {lead.lastCrmActivityAt
                      ? new Date(lead.lastCrmActivityAt).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-xs text-blue-600 hover:underline"
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
      <div className="mt-4 flex gap-3 text-sm">
        {page > 1 && (
          <Link
            href={`/leads?${stateFilter ? `state=${stateFilter}&` : ''}page=${page - 1}`}
            className="text-blue-600 hover:underline"
          >
            ← Previous
          </Link>
        )}
        {rows.length === limit && (
          <Link
            href={`/leads?${stateFilter ? `state=${stateFilter}&` : ''}page=${page + 1}`}
            className="text-blue-600 hover:underline"
          >
            Next →
          </Link>
        )}
      </div>
    </div>
  )
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active
          ? 'bg-gray-900 text-white'
          : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </Link>
  )
}

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { getMessageAuditLog } from '@/lib/admin/dlr-queries'

const STATUS_COLOR: Record<string, string> = {
  sent:      'text-green-600',
  delivered: 'text-green-600',
  failed:    'text-red-600',
  received:  'text-blue-600',
  queued:    'text-gray-500',
}

export default async function MessageAuditPage({
  searchParams,
}: {
  searchParams: {
    direction?: string
    skipOnly?: string
    leadId?: string
    offset?: string
  }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const direction     = (searchParams.direction ?? undefined) as 'inbound' | 'outbound' | undefined
  const skipReasonOnly = searchParams.skipOnly === '1'
  const leadId        = searchParams.leadId ?? undefined
  const offset        = Math.max(0, parseInt(searchParams.offset ?? '0'))
  const limit         = 100

  const msgs = await getMessageAuditLog(session.user.tenantId, {
    limit, offset, direction, skipReasonOnly, leadId,
  })

  return (
    <div className="px-8 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Message Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">All inbound and outbound messages — including skipped sends</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterPill href="/admin/dlr/messages"                    active={!direction && !skipReasonOnly} label="All" />
        <FilterPill href="/admin/dlr/messages?direction=outbound" active={direction === 'outbound'}      label="Outbound" />
        <FilterPill href="/admin/dlr/messages?direction=inbound"  active={direction === 'inbound'}       label="Inbound" />
        <FilterPill href="/admin/dlr/messages?skipOnly=1"         active={skipReasonOnly}                label="Skipped only" color="text-red-600 border-red-200" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {msgs.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">No messages found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Time', 'Lead', 'Dir', 'Status', 'Body', 'Skip reason', 'Provider ID'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {msgs.map((msg) => (
                <tr key={msg.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                    {msg.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/dlr/leads/${msg.lead.id}`}
                      className="text-xs font-semibold text-gray-900 hover:text-red-600 whitespace-nowrap"
                    >
                      {msg.lead.firstName} {msg.lead.lastName}
                    </Link>
                    <p className="text-xs text-gray-400 font-mono">{msg.lead.phone}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold ${msg.direction === 'inbound' ? 'text-blue-600' : 'text-gray-500'}`}>
                      {msg.direction === 'inbound' ? '↓ in' : '↑ out'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`text-xs font-semibold ${STATUS_COLOR[msg.status] ?? 'text-gray-600'}`}>
                      {msg.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 max-w-[200px]">
                    <p className="text-xs text-gray-600 truncate">{msg.body}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {msg.skipReason ? (
                      <span className="text-xs font-mono text-red-600">{msg.skipReason}</span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-mono text-gray-400">
                      {msg.providerMessageId?.slice(0, 14) ?? '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {(offset > 0 || msgs.length === limit) && (
        <div className="mt-4 flex gap-2 items-center">
          {offset > 0 && (
            <Link
              href={`/admin/dlr/messages?offset=${offset - limit}${direction ? `&direction=${direction}` : ''}${skipReasonOnly ? '&skipOnly=1' : ''}`}
              className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              ← Previous
            </Link>
          )}
          {msgs.length === limit && (
            <Link
              href={`/admin/dlr/messages?offset=${offset + limit}${direction ? `&direction=${direction}` : ''}${skipReasonOnly ? '&skipOnly=1' : ''}`}
              className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function FilterPill({
  href, active, label, color,
}: {
  href: string; active: boolean; label: string; color?: string
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
        active
          ? 'bg-gray-900 text-white border-gray-900'
          : `text-gray-500 border-gray-200 hover:bg-gray-50 ${color ?? ''}`
      }`}
    >
      {label}
    </Link>
  )
}

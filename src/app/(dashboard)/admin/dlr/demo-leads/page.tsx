import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoLeads } from '@/lib/db/schema'
import { markContacted } from './actions'

export default async function DemoLeadsPage() {
  const leads = await db
    .select()
    .from(demoLeads)
    .orderBy(desc(demoLeads.createdAt))

  const fmt = (d: Date | null) =>
    d
      ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null

  return (
    <div className="min-h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-5">
        <h1 className="text-xl font-bold text-gray-900">Demo Requests</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Inbound leads from the /book-demo landing page. Reach out and mark contacted.
        </p>
      </div>

      <div className="px-8 py-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {leads.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-gray-400">
              No demo requests yet.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
                  {['Dealership', 'Decision Maker', 'Phone', 'Email', 'Status', 'Submitted', 'Last Contact', 'Notes', ''].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr
                    key={lead.id}
                    className="hover:bg-gray-50 transition-colors"
                    style={{ borderBottom: '1px solid #f9fafb' }}
                  >
                    <td className="px-4 py-3.5">
                      <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                        {lead.dealershipName}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-gray-700 whitespace-nowrap">
                      {lead.decisionMakerName}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                      <a href={`tel:${lead.phone}`} className="hover:text-red-600 transition-colors">
                        {lead.phone}
                      </a>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-gray-600">
                      <a href={`mailto:${lead.email}`} className="hover:text-red-600 transition-colors">
                        {lead.email}
                      </a>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
                          lead.status === 'contacted'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                      {fmt(lead.createdAt)}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                      {fmt(lead.lastContactedAt) ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-gray-500 max-w-xs">
                      {lead.notes || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      {lead.status !== 'contacted' && (
                        <form action={markContacted.bind(null, lead.id)}>
                          <button
                            type="submit"
                            className="text-xs font-semibold text-red-600 hover:text-red-700 transition-colors"
                          >
                            Mark Contacted →
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

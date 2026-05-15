import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'
import Link from 'next/link'
import { getLaunchStatusLabel, getLaunchStatusColor } from '@/lib/intake/checklist'
import { generateIntakeLink } from './actions'

export default async function IntakesPage() {
  const intakes = await db
    .select()
    .from(dealerIntakes)
    .orderBy(desc(dealerIntakes.createdAt))

  return (
    <div className="min-h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Dealer Intakes</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Generate an onboarding link, send it to the dealer, track their launch progress.
            </p>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Generate new intake link */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Generate New Intake Link</h2>
          <p className="text-xs text-gray-500 mb-4">
            Enter the dealership name, then copy the link and send it to your new dealer.
          </p>
          <form action={generateIntakeLink} className="flex items-center gap-3">
            <input
              name="dealershipName"
              type="text"
              placeholder="e.g. Smith Honda"
              required
              className="flex-1 max-w-xs px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <button
              type="submit"
              className="px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition-colors"
              style={{ backgroundColor: '#dc2626' }}
            >
              Generate Link →
            </button>
          </form>
        </div>

        {/* Intakes table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {intakes.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-gray-400">
              No intakes yet. Generate your first link above.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
                  {['Dealership', 'Status', 'Contact', 'Submitted', 'Created', ''].map(h => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {intakes.map(intake => (
                  <tr
                    key={intake.id}
                    className="hover:bg-gray-50 transition-colors"
                    style={{ borderBottom: '1px solid #f9fafb' }}
                  >
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-gray-900">
                        {intake.dealershipName ?? <span className="text-gray-400 italic">Unnamed</span>}
                      </p>
                      {intake.businessLegalName && (
                        <p className="text-xs text-gray-400">{intake.businessLegalName}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${getLaunchStatusColor(intake.launchStatus)}`}
                      >
                        {getLaunchStatusLabel(intake.launchStatus)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      {intake.primaryContactName ?? <span className="text-gray-300">—</span>}
                      {intake.primaryContactEmail && (
                        <p className="text-xs text-gray-400">{intake.primaryContactEmail}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-400">
                      {intake.submittedAt
                        ? new Date(intake.submittedAt).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })
                        : <span className="text-gray-300">Not yet</span>}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-400">
                      {new Date(intake.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric',
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={`/admin/dlr/intakes/${intake.id}`}
                        className="text-xs font-semibold text-red-600 hover:text-red-700"
                      >
                        Launch Checklist →
                      </Link>
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

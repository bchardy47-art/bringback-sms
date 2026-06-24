import { redirect } from 'next/navigation'
import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { outreachSuppressions } from '@/lib/db/schema'
import { getAdminUser } from '@/lib/admin/access'
import { addSuppressionAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function SuppressionPage() {
  const user = await getAdminUser()
  if (!user) redirect('/login?callbackUrl=/admin/outreach/suppression')

  const rows = await db.select().from(outreachSuppressions).orderBy(desc(outreachSuppressions.createdAt)).limit(500)

  return (
    <div className="px-4 md:px-8 py-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Suppression list</h1>
        <p className="text-sm text-gray-500 mt-1">
          Emails and domains that must never receive outreach. Marking a prospect &ldquo;do-not-contact&rdquo; adds them here automatically.
          The send path checks this list before every real send.
        </p>
      </div>

      <form action={addSuppressionAction} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Add suppression</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input name="email" placeholder="email@dealership.com" className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg" />
          <input name="domain" placeholder="or whole domain.com" className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg" />
          <input name="reason" placeholder="Reason" className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg" />
        </div>
        <button type="submit" className="px-3 py-1.5 text-xs font-semibold text-white bg-gray-900 rounded-lg hover:bg-black">Add to suppression</button>
        <p className="text-xs text-gray-400">Provide an email, a domain, or both.</p>
      </form>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider text-left">
            <tr>
              <th className="px-3 py-3">Added</th>
              <th className="px-3 py-3">Email</th>
              <th className="px-3 py-3">Domain</th>
              <th className="px-3 py-3">Reason</th>
              <th className="px-3 py-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">No suppressions.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{r.createdAt.toLocaleDateString()}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{r.email || '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{r.domain || '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{r.reason || '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-400">{r.source || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, desc, eq, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { outreachSends } from '@/lib/db/schema'
import { getAdminUser } from '@/lib/admin/access'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, string> = {
  sent: 'bg-emerald-100 text-emerald-700',
  test_sent: 'bg-blue-100 text-blue-700',
  dry_run: 'bg-amber-100 text-amber-700',
  skipped: 'bg-gray-100 text-gray-500',
  failed: 'bg-red-100 text-red-700',
}

export default async function SendsLogPage({ searchParams }: { searchParams: { status?: string } }) {
  const user = await getAdminUser()
  if (!user) redirect('/login?callbackUrl=/admin/outreach/sends')

  const status = (searchParams.status ?? '').trim()
  const conds: SQL[] = []
  if (status) conds.push(eq(outreachSends.status, status))

  const rows = await db
    .select()
    .from(outreachSends)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(outreachSends.createdAt))
    .limit(300)

  const statuses = ['sent', 'test_sent', 'dry_run', 'skipped', 'failed']

  return (
    <div className="px-4 md:px-8 py-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sent log</h1>
          <p className="text-sm text-gray-500 mt-1">Every outreach attempt — sent, test, dry-run, skipped, or failed — with its reason.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Link href="/admin/outreach/sends" className={`px-2.5 py-1 text-xs font-medium rounded-lg border ${!status ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}`}>All</Link>
        {statuses.map(s => (
          <Link key={s} href={`/admin/outreach/sends?status=${s}`} className={`px-2.5 py-1 text-xs font-medium rounded-lg border ${status === s ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{s}</Link>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider text-left">
            <tr>
              <th className="px-3 py-3">When</th>
              <th className="px-3 py-3">To</th>
              <th className="px-3 py-3">Subject</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Reason</th>
              <th className="px-3 py-3">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No sends logged.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{r.createdAt.toLocaleString()}</td>
                <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-[180px]">{r.toEmail}{r.isTest && <span className="ml-1 text-blue-500">(test)</span>}</td>
                <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[220px]">{r.subject}</td>
                <td className="px-3 py-2"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_TONE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>{r.status}</span></td>
                <td className="px-3 py-2 text-xs text-gray-500">{r.skipReason || r.failureReason || '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-400 truncate max-w-[140px]">{r.sentByEmail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

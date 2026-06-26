/**
 * /admin/outreach — Brian's dealer-outreach CRM dashboard.
 *
 * Admin-viewable; sends are Brian-only (gated in actions + the table component).
 * Read path here: monthly stats + action cards + a filterable prospect table.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminUser, isBrian } from '@/lib/admin/access'
import { trackEvent } from '@/lib/activity/track'
import { ensureDefaultTemplates } from '@/lib/outreach/templates'
import { getOutreachStats, listProspects, statusLabel, statusChipClass, PROSPECT_STATUS_LABELS } from '@/lib/outreach/queries'
import { maxBatchSize, sendEnabled } from '@/lib/outreach/eligibility'
import { ProspectTableClient, type ClientProspect } from './ProspectTableClient'

export const dynamic = 'force-dynamic'

type SearchParams = { status?: string; priority?: string; q?: string }

export default async function OutreachDashboard({ searchParams }: { searchParams: SearchParams }) {
  const user = await getAdminUser()
  if (!user) redirect('/login?callbackUrl=/admin/outreach')
  const brian = isBrian(user)

  await ensureDefaultTemplates()
  await trackEvent('admin_outreach_viewed', { actor: user, path: '/admin/outreach' })

  const status = (searchParams.status ?? '').trim()
  const priority = (searchParams.priority ?? '').trim()
  const q = (searchParams.q ?? '').trim()

  const [stats, prospects] = await Promise.all([
    getOutreachStats(),
    listProspects({ status: status || undefined, priority: priority || undefined, q: q || undefined }),
  ])

  const clientRows: ClientProspect[] = prospects.map(p => ({
    id: p.id,
    dealershipName: p.dealershipName,
    city: p.city, state: p.state, website: p.website,
    bestContactName: p.bestContactName, bestContactTitle: p.bestContactTitle,
    publicEmail: p.publicEmail, contactFormUrl: p.contactFormUrl, sourceUrl: p.sourceUrl,
    priority: p.priority, status: p.status,
    statusLabel: statusLabel(p.status), statusChip: statusChipClass(p.status),
    lastContactedAt: p.lastContactedAt ? p.lastContactedAt.toISOString() : null,
    nextEligibleAt: p.nextEligibleAt ? p.nextEligibleAt.toISOString() : null,
    personalizationLine: p.personalizationLine,
    eligible: p.eligibility.eligible,
    eligibilityDetail: p.eligibility.detail,
  }))

  const statCards = [
    { label: 'Ready to send', value: stats.readyToSend, tone: stats.readyToSend > 0 ? 'good' : 'muted' },
    { label: 'Sent this month', value: stats.sentThisMonth, tone: 'muted' },
    { label: 'Replies / interested', value: stats.repliesInterested, tone: stats.repliesInterested > 0 ? 'good' : 'muted' },
    { label: 'Demo booked', value: stats.demoBooked, tone: stats.demoBooked > 0 ? 'good' : 'muted' },
    { label: 'Do-not-contact', value: stats.doNotContact, tone: 'muted' },
    { label: 'Missing email/source', value: stats.missingEmailOrSource, tone: stats.missingEmailOrSource > 0 ? 'warn' : 'muted' },
  ] as const

  return (
    <div className="px-4 md:px-8 py-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Dealer Outreach · Controlled monthly demo invites</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Outreach Console</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review-first prospect outreach. One demo invite per dealership per 30 days. Signed in as {user.email}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${sendEnabled() ? 'bg-red-600 text-white' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}`}>
            {sendEnabled() ? 'Live sending armed' : 'Test mode — real dealer emails are off'}
          </span>
        </div>
      </div>

      {/* Monthly stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {statCards.map(c => (
          <div key={c.label} className={`bg-white rounded-xl border p-3 md:p-4 ${c.tone === 'warn' ? 'border-orange-200' : 'border-gray-200'}`}>
            <p className="text-xs font-medium text-gray-500">{c.label}</p>
            <p className={`text-2xl md:text-3xl font-bold mt-1 ${
              c.tone === 'good' ? 'text-emerald-600' : c.tone === 'warn' ? 'text-orange-600' : 'text-gray-900'
            }`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <ActionCard href="#prospects" title="Review ready prospects" desc="Filter to eligible and send" />
        <ActionCard href="/admin/outreach/import" title="Import prospects" desc="Paste CSV/TSV research" />
        <ActionCard href="/admin/outreach/templates" title="Manage templates" desc="Preview demo invite copy" />
        <ActionCard href="/admin/outreach/sends" title="Sent log" desc="Every attempt, with reasons" />
        <ActionCard href="/admin/outreach/suppression" title="Suppression list" desc="Do-not-contact records" />
      </div>

      {/* Filters + table */}
      <section id="prospects" className="space-y-3 scroll-mt-20">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Prospects ({prospects.length})</h2>
          {stats.lastSendAt && (
            <span className="text-xs text-gray-400">Last send {stats.lastSendAt.toLocaleDateString()}</span>
          )}
        </div>

        <form method="GET" className="flex flex-wrap items-center gap-2">
          <input
            name="q" defaultValue={q} placeholder="Search dealership / email / city"
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-red-100"
          />
          <select name="status" defaultValue={status} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg">
            <option value="">All statuses</option>
            {Object.entries(PROSPECT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select name="priority" defaultValue={priority} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg">
            <option value="">All priorities</option>
            <option value="A">A</option><option value="B">B</option><option value="C">C</option>
          </select>
          <button type="submit" className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">Filter</button>
          {(q || status || priority) && (
            <Link href="/admin/outreach" className="px-3 py-1.5 text-sm text-gray-500 hover:underline">Reset</Link>
          )}
        </form>

        <ProspectTableClient prospects={clientRows} brian={brian} maxBatch={maxBatchSize()} />
      </section>
    </div>
  )
}

function ActionCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm hover:border-gray-300 transition-all">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
    </Link>
  )
}

/**
 * /admin/activity — first-party, read-only activity log.
 *
 * Admin-only (the (dashboard)/admin layout already gates role==='admin';
 * we re-check here as defense in depth). Reads from the `activity_events`
 * table only — no paid analytics. Styling matches the light admin console.
 */

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { and, count, desc, eq, gte, ilike, inArray, type SQL } from 'drizzle-orm'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { activityEvents } from '@/lib/db/schema'
import { trackEvent } from '@/lib/activity/track'
import { ActivityLiveControls } from './ActivityLiveControls'

export const dynamic = 'force-dynamic'

const EVENT_LABELS: Record<string, string> = {
  login_success: 'Login',
  logout_clicked: 'Logout',
  dealer_dashboard_viewed: 'Dashboard view',
  dealer_import_viewed: 'Import view',
  dealer_campaigns_viewed: 'Campaigns view',
  dealer_campaign_detail_viewed: 'Campaign detail',
  dealer_settings_viewed: 'Settings view',
  admin_activity_viewed: 'Admin activity view',
  admin_command_center_viewed: 'Command center view',
  admin_dealer_detail_viewed: 'Dealer detail view',
  admin_outreach_viewed: 'Outreach view',
  outreach_prospect_imported: 'Prospects imported',
  outreach_template_previewed: 'Outreach preview',
  outreach_test_email_sent: 'Outreach test sent',
  outreach_monthly_invite_sent: 'Demo invite sent',
  outreach_monthly_invite_skipped: 'Demo invite skipped',
  outreach_batch_send_started: 'Outreach batch started',
  outreach_batch_send_completed: 'Outreach batch completed',
  outreach_prospect_marked_dnc: 'Prospect marked DNC',
  outreach_prospect_status_changed: 'Prospect status changed',
}
const labelFor = (t: string) => EVENT_LABELS[t] ?? t

type SearchParams = { type?: string; tenant?: string; q?: string; _t?: string }

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/admin/activity')
  if (session.user.role !== 'admin') redirect('/dashboard')

  // `_t` is only set by the live auto/manual refresh. Skip the page-view ping
  // on those background refreshes so the monitor isn't flooded with the
  // admin's own "Admin activity view" events. Real loads/filter-applies (no
  // `_t`) track exactly as before.
  if (!searchParams._t) {
    await trackEvent('admin_activity_viewed', { actor: session.user, path: '/admin/activity' })
  }

  const renderedAt = new Date().toISOString()

  const type = (searchParams.type ?? '').trim()
  const tenant = (searchParams.tenant ?? '').trim()
  const q = (searchParams.q ?? '').trim()

  const conds = []
  if (type) conds.push(eq(activityEvents.eventType, type))
  if (tenant) conds.push(eq(activityEvents.tenantName, tenant))
  if (q) conds.push(ilike(activityEvents.actorEmail, `%${q}%`))
  const where = conds.length ? and(...conds) : undefined

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const n = (r: Array<{ n: number }>) => r[0]?.n ?? 0
  const in24 = (extra?: SQL) =>
    db.select({ n: count() }).from(activityEvents).where(extra ? and(gte(activityEvents.createdAt, since), extra) : gte(activityEvents.createdAt, since))

  const [rows, typeRows, tenantRows, c24, cLogins, cDash, cUpload, cCampaigns] = await Promise.all([
    db.select().from(activityEvents).where(where).orderBy(desc(activityEvents.createdAt)).limit(200),
    db.selectDistinct({ v: activityEvents.eventType }).from(activityEvents),
    db.selectDistinct({ v: activityEvents.tenantName }).from(activityEvents),
    in24(),
    db.select({ n: count() }).from(activityEvents).where(and(gte(activityEvents.createdAt, since), eq(activityEvents.eventType, 'login_success'), eq(activityEvents.actorRole, 'dealer'))),
    in24(eq(activityEvents.eventType, 'dealer_dashboard_viewed')),
    in24(eq(activityEvents.eventType, 'dealer_import_viewed')),
    in24(inArray(activityEvents.eventType, ['dealer_campaigns_viewed', 'dealer_campaign_detail_viewed'])),
  ])

  const eventTypes = typeRows.map(r => r.v).filter(Boolean).sort()
  const tenantNames = tenantRows.map(r => r.v).filter((v): v is string => !!v).sort()

  const cards = [
    { label: 'Events · last 24h', value: n(c24) },
    { label: 'Dealer logins · 24h', value: n(cLogins) },
    { label: 'Dashboard views · 24h', value: n(cDash) },
    { label: 'Upload views · 24h', value: n(cUpload) },
    { label: 'Campaign views · 24h', value: n(cCampaigns) },
  ]

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activity</h1>
          <p className="text-sm text-gray-500 mt-1">
            First-party event log (read-only). Newest first · last 200 matching events. Live · auto-refreshes every 30s.
          </p>
        </div>
        <ActivityLiveControls renderedAt={renderedAt} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {cards.map(c => (
          <div key={c.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Filters (GET form) */}
      <form method="get" className="flex flex-wrap items-end gap-3 mb-4 bg-white border border-gray-200 rounded-xl p-4">
        <label className="flex flex-col text-xs text-gray-500">
          Event type
          <select name="type" defaultValue={type} className="mt-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 min-w-[180px]">
            <option value="">All events</option>
            {eventTypes.map(t => <option key={t} value={t}>{labelFor(t)}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          Dealer / tenant
          <select name="tenant" defaultValue={tenant} className="mt-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 min-w-[180px]">
            <option value="">All tenants</option>
            {tenantNames.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          User / email
          <input name="q" defaultValue={q} placeholder="email contains…" className="mt-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 min-w-[200px]" />
        </label>
        <button type="submit" className="bg-gray-900 text-white text-sm font-semibold rounded-lg px-4 py-2">Apply</button>
        {(type || tenant || q) && (
          <a href="/admin/activity" className="text-sm text-gray-500 underline px-2 py-2">Clear</a>
        )}
      </form>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Event</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Dealer / Tenant</th>
              <th className="px-4 py-3 font-medium">Path</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No activity yet.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-gray-900 font-medium">{labelFor(r.eventType)}</td>
                <td className="px-4 py-2.5 text-gray-700">{r.actorEmail ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-500 capitalize">{r.actorRole ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-700">{r.tenantName ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{r.path ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

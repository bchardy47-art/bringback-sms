/**
 * /admin — DLR Admin Command Center (Brian's daily cockpit).
 *
 * One surface that answers: who needs attention, what's safe to move forward,
 * what changed, which dealers/prospects need follow-up, which demo invites can
 * be sent. Read-only aggregation (src/lib/admin/command-center.ts). Links into
 * the existing /admin/dlr/** operator pages and the new /admin/outreach CRM.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminUser } from '@/lib/admin/access'
import { trackEvent } from '@/lib/activity/track'
import { getCommandCenter, type AdminTask, type DealerCard, type ActivityRow } from '@/lib/admin/command-center'

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
  outreach_monthly_invite_sent: 'Demo invite sent',
  outreach_monthly_invite_skipped: 'Demo invite skipped',
  outreach_test_email_sent: 'Outreach test sent',
}
const labelFor = (t: string) => EVENT_LABELS[t] ?? t

const STATUS_CHIP: Record<DealerCard['status'], string> = {
  Live: 'bg-emerald-100 text-emerald-700',
  Ready: 'bg-teal-100 text-teal-700',
  Testing: 'bg-amber-100 text-amber-700',
  Setup: 'bg-gray-100 text-gray-600',
  Paused: 'bg-orange-100 text-orange-700',
  Blocked: 'bg-red-100 text-red-700',
}

function ago(d: Date | null): string {
  if (!d) return '—'
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default async function AdminCommandCenter() {
  const user = await getAdminUser()
  if (!user) redirect('/login?callbackUrl=/admin')

  await trackEvent('admin_command_center_viewed', { actor: user, path: '/admin' })
  const cc = await getCommandCenter()

  return (
    <div className="px-4 md:px-8 py-6 space-y-7 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">BCHardy LLC · DLR Operations</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-0.5">DLR Admin Command Center</h1>
          <p className="text-sm text-gray-500 mt-1">Your daily queue for dealers, campaigns, outreach, messages, and system checks.</p>
          <p className="text-xs text-gray-400 mt-1">Signed in as {user.email}</p>
        </div>
      </div>

      {/* Quick buttons */}
      <div className="flex flex-wrap gap-2">
        <QuickButton href="/admin/outreach" label="Dealer Outreach" primary />
        <QuickButton href="/admin/dlr/pilot" label="Review Pilot Batches" />
        <QuickButton href="/admin/dlr/messages" label="Messages / Replies" />
        <QuickButton href="/admin/activity" label="Activity" />
        <QuickButton href="/admin/dlr/health" label="System Health" />
      </div>

      {/* Setup Pipeline pointer — onboarding lives on the older /admin/dlr view */}
      <Link
        href="/admin/dlr"
        className="flex items-center justify-between gap-4 bg-white rounded-xl border border-gray-200 px-5 py-3.5 hover:border-gray-300 hover:shadow-sm transition-all"
      >
        <div>
          <p className="text-sm font-semibold text-gray-900">Setup Pipeline →</p>
          <p className="text-xs text-gray-500 mt-0.5">Dealer onboarding, intakes, 10DLC, numbers, and pilot setup.</p>
        </div>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Onboarding</span>
      </Link>

      {/* Needs Brian queue */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Needs Brian — next action queue</h2>
        {cc.tasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-400 text-center">
            Nothing needs you right now. 🎉
          </div>
        ) : (
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {cc.tasks.map((t: AdminTask) => (
              <li key={t.id} className="px-5 py-3 flex items-center gap-4">
                <span className={`inline-flex w-2 h-2 rounded-full flex-shrink-0 ${
                  t.priority === 'high' ? 'bg-red-500' : t.priority === 'medium' ? 'bg-amber-500' : 'bg-blue-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {t.title}
                    {t.badge && <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600">{t.badge}</span>}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t.description}{t.entityName ? ` · ${t.entityName}` : ''}
                  </p>
                </div>
                <span className={`hidden sm:inline text-xs font-semibold uppercase ${
                  t.priority === 'high' ? 'text-red-600' : t.priority === 'medium' ? 'text-amber-600' : 'text-blue-600'
                }`}>{t.priority}</span>
                <Link href={t.href} className="text-xs font-semibold text-red-600 hover:text-red-700 flex-shrink-0">Go →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dealer status cards */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Dealers</h2>
          <Link href="/admin/dlr/dealers" className="text-xs text-red-600 hover:underline">All dealers →</Link>
        </div>
        {cc.dealers.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-400 text-center">No dealerships provisioned yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cc.dealers.map(d => (
              <div key={d.tenantId} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/admin/dealers/${d.tenantId}`} className="font-semibold text-gray-900 hover:text-red-600 truncate">{d.name}</Link>
                  <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_CHIP[d.status]}`}>{d.status}</span>
                </div>
                <div className="grid grid-cols-4 gap-1 mt-3 text-center">
                  <Metric label="Leads" value={d.leads} />
                  <Metric label="Batches" value={d.pilotBatches} />
                  <Metric label="Sent" value={d.messagesSent} />
                  <Metric label="Replies" value={d.replies} />
                </div>
                {d.blockingIssue && <p className="text-xs text-red-600 mt-2">⚠ {d.blockingIssue}</p>}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                  <span className="text-xs text-gray-400">Active {ago(d.lastActivityAt)}</span>
                  <div className="flex gap-2">
                    <Link href={`/admin/dealers/${d.tenantId}`} className="text-xs font-semibold text-red-600 hover:text-red-700">Open →</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Outreach + Activity + System snapshots */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Outreach snapshot */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Outreach</h2>
            <Link href="/admin/outreach" className="text-xs text-red-600 hover:underline">Queue →</Link>
          </div>
          <dl className="space-y-1.5 text-sm">
            <SnapRow label="Eligible to send" value={cc.outreach.readyToSend} highlight={cc.outreach.readyToSend > 0} />
            <SnapRow label="Contacted (30d)" value={cc.outreach.contactedLast30} />
            <SnapRow label="Sent this month" value={cc.outreach.sentThisMonth} />
            <SnapRow label="Replies / interested" value={cc.outreach.repliesInterested} highlight={cc.outreach.repliesInterested > 0} />
            <SnapRow label="Demo booked" value={cc.outreach.demoBooked} />
            <SnapRow label="Do-not-contact" value={cc.outreach.doNotContact} />
            <SnapRow label="Missing email/source" value={cc.outreach.missingEmailOrSource} />
          </dl>
          <p className="text-xs text-gray-400 mt-3">Last send: {cc.outreach.lastSendAt ? cc.outreach.lastSendAt.toLocaleDateString() : '—'}</p>
        </section>

        {/* Activity snapshot */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Recent activity</h2>
            <Link href="/admin/activity" className="text-xs text-red-600 hover:underline">All →</Link>
          </div>
          <p className="text-xs text-gray-400 mb-2">Last dealer login: {cc.lastDealerLoginAt ? ago(cc.lastDealerLoginAt) : '—'}</p>
          {cc.recentActivity.length === 0 ? (
            <p className="text-xs text-gray-400">No activity yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {cc.recentActivity.map((a: ActivityRow) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-700 truncate">{labelFor(a.eventType)}</span>
                  <span className="text-gray-400 truncate max-w-[120px]">{a.tenantName || a.actorEmail || a.actorRole || '—'}</span>
                  <span className="text-gray-300 flex-shrink-0">{ago(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* System snapshot */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">System</h2>
            <Link href="/admin/dlr/health" className="text-xs text-red-600 hover:underline">Health →</Link>
          </div>
          <div className="space-y-1.5">
            <StatusRow label="Live texting" ok={cc.system.smsLiveMode} yes="on" no="test mode" />
            <StatusRow label="Message sending" ok={!cc.system.dryRun} yes="enabled" no="suppressed (test)" />
            <StatusRow label="Outreach emails" ok={cc.system.outreachSendEnabled} yes="live sending armed" no="test mode — emails off" />
          </div>
          <dl className="space-y-1.5 text-sm mt-3 pt-3 border-t border-gray-100">
            <SnapRow label="Failed sends (24h)" value={cc.system.failedSends24h} highlight={cc.system.failedSends24h > 0} warn />
            <SnapRow label="Skipped sends (24h)" value={cc.system.skippedSends24h} />
            <SnapRow label="Pending approvals" value={cc.system.pendingApprovals} highlight={cc.system.pendingApprovals > 0} />
          </dl>
        </section>
      </div>
    </div>
  )
}

function QuickButton({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <Link href={href} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
      primary ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
    }`}>{label}</Link>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-base font-bold text-gray-900">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
    </div>
  )
}

function SnapRow({ label, value, highlight, warn }: { label: string; value: number; highlight?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`font-bold ${highlight ? (warn ? 'text-red-600' : 'text-emerald-600') : 'text-gray-900'}`}>{value}</dd>
    </div>
  )
}

function StatusRow({ label, ok, yes, no }: { label: string; ok: boolean; yes: string; no: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-600">{label}</span>
      <span className={`flex items-center gap-1.5 text-xs font-semibold ${ok ? 'text-green-600' : 'text-amber-600'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-amber-500'}`} />
        {ok ? yes : no}
      </span>
    </div>
  )
}

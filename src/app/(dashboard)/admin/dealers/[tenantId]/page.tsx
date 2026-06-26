/**
 * /admin/dealers/[tenantId] — single dealer command page.
 *
 * Combines scattered per-dealer admin info: profile, setup checklist, contacts,
 * lead imports, pilot batches, message/reply summary, handoffs, SMS/number
 * status, recent activity, admin notes, and safe admin actions (pause/resume).
 * Read-only except the notes + pause/resume server actions.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  tenants, users, leads, pilotBatches, pilotLeadImports, conversations,
  messages, handoffTasks, activityEvents, adminNotes,
} from '@/lib/db/schema'
import { getAdminUser } from '@/lib/admin/access'
import { trackEvent } from '@/lib/activity/track'
import { addAdminNoteAction, pauseDealerAction, resumeDealerAction } from '../actions'
import { ConfirmingForm } from '../../dlr/ConfirmingForm'

export const dynamic = 'force-dynamic'

function ago(d: Date | null): string {
  if (!d) return '—'
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 60) return `${Math.max(mins, 0)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default async function DealerDetailPage({ params }: { params: { tenantId: string } }) {
  const user = await getAdminUser()
  if (!user) redirect(`/login?callbackUrl=/admin/dealers/${params.tenantId}`)

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, params.tenantId) })
  if (!tenant) notFound()

  await trackEvent('admin_dealer_detail_viewed', {
    actor: user, path: `/admin/dealers/${params.tenantId}`,
    metadata: { tenantId: tenant.id, tenantName: tenant.name },
  })

  const [
    tenantUsers, leadCountRow, importCountRow, batches, msgRows,
    openHandoffsRow, recentActivity, notes,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.tenantId, tenant.id)),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.tenantId, tenant.id)),
    db.select({ n: sql<number>`count(*)::int` }).from(pilotLeadImports).where(eq(pilotLeadImports.tenantId, tenant.id)),
    db.select().from(pilotBatches).where(eq(pilotBatches.tenantId, tenant.id)).orderBy(desc(pilotBatches.createdAt)).limit(10),
    db.select({ direction: messages.direction, status: messages.status, n: sql<number>`count(*)::int` })
      .from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(conversations.tenantId, tenant.id)).groupBy(messages.direction, messages.status),
    db.select({ n: sql<number>`count(*)::int` }).from(handoffTasks)
      .where(and(eq(handoffTasks.tenantId, tenant.id), inArray(handoffTasks.status, ['open', 'in_progress']))),
    db.select().from(activityEvents).where(eq(activityEvents.tenantId, tenant.id)).orderBy(desc(activityEvents.createdAt)).limit(15),
    db.select().from(adminNotes).where(eq(adminNotes.tenantId, tenant.id)).orderBy(desc(adminNotes.createdAt)),
  ])

  const leadCount = leadCountRow[0]?.n ?? 0
  const importCount = importCountRow[0]?.n ?? 0
  const messagesSent = msgRows.filter(r => r.direction === 'outbound' && (r.status === 'sent' || r.status === 'delivered')).reduce((s, r) => s + r.n, 0)
  const replies = msgRows.filter(r => r.direction === 'inbound').reduce((s, r) => s + r.n, 0)
  const openHandoffs = openHandoffsRow[0]?.n ?? 0
  const completedBatches = batches.filter(b => b.completedAt).length

  // Setup checklist derived from tenant flags + counts (no intake dependency).
  const checklist: Array<{ label: string; done: boolean }> = [
    { label: 'Dealer account created', done: true },
    { label: 'Dealer user(s) invited', done: tenantUsers.some(u => u.role === 'dealer' || u.role === 'manager') },
    { label: 'Phone / SMS number assigned', done: !!tenant.smsSendingNumber },
    { label: 'SMS live approved', done: tenant.smsLiveApproved },
    { label: 'Leads uploaded', done: leadCount > 0 || importCount > 0 },
    { label: 'Pilot batch generated', done: batches.length > 0 },
    { label: 'Pilot batch completed', done: completedBatches > 0 },
    { label: 'Live (not paused)', done: !!tenant.liveActivatedAt && !tenant.automationPaused },
  ]

  return (
    <div className="px-4 md:px-8 py-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <Link href="/admin" className="text-xs text-gray-500 hover:underline">← Command Center</Link>
        <div className="flex flex-wrap items-center gap-3 mt-1">
          <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
          {tenant.complianceBlocked && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Compliance blocked</span>}
          {tenant.automationPaused && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">Paused</span>}
          {tenant.liveActivatedAt && !tenant.automationPaused && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Live</span>}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{tenant.slug} · {tenant.id}</p>
      </div>

      {/* Quick metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric label="Leads" value={leadCount} />
        <Metric label="Imports" value={importCount} />
        <Metric label="Pilot batches" value={batches.length} />
        <Metric label="Messages sent" value={messagesSent} />
        <Metric label="Replies" value={replies} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Setup checklist */}
          <Card title="Setup checklist">
            <ul className="space-y-1.5">
              {checklist.map(c => (
                <li key={c.label} className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex w-4 h-4 rounded-full items-center justify-center text-xs ${c.done ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>{c.done ? '✓' : '○'}</span>
                  <span className={c.done ? 'text-gray-700' : 'text-gray-400'}>{c.label}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* SMS / number status */}
          <Card title="SMS & number status">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Field label="Sending number" value={tenant.smsSendingNumber || <span className="text-orange-500">unassigned</span>} />
              <Field label="SMS live approved" value={tenant.smsLiveApproved ? 'Yes' : <span className="text-orange-500">No</span>} />
              <Field label="10DLC status" value={tenant.tenDlcStatus} />
              <Field label="Automation" value={tenant.automationPaused ? <span className="text-orange-600">paused</span> : 'running'} />
              <Field label="Open handoffs" value={openHandoffs} />
              <Field label="Live activated" value={tenant.liveActivatedAt ? tenant.liveActivatedAt.toLocaleDateString() : '—'} />
            </dl>
          </Card>

          {/* Pilot batches */}
          <Card title="Pilot batches">
            {batches.length === 0 ? <p className="text-xs text-gray-400">No pilot batches.</p> : (
              <ul className="divide-y divide-gray-100 text-sm">
                {batches.map(b => (
                  <li key={b.id} className="py-2 flex items-center justify-between gap-3">
                    <Link href={`/admin/dlr/pilot/${b.id}`} className="text-gray-700 hover:text-red-600 truncate">
                      {b.isFirstPilot ? 'First pilot' : 'Pilot'} · {b.createdAt.toLocaleDateString()}
                    </Link>
                    <span className="text-xs text-gray-500">{b.status} · {b.liveSendCount} sent · {b.replyCount} replies</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Contacts */}
          <Card title="Contacts / users">
            {tenantUsers.length === 0 ? <p className="text-xs text-gray-400">No users.</p> : (
              <ul className="divide-y divide-gray-100 text-sm">
                {tenantUsers.map(u => (
                  <li key={u.id} className="py-2 flex items-center justify-between gap-3">
                    <span className="text-gray-700 truncate">{u.name} <span className="text-gray-400">· {u.email}</span></span>
                    <span className="text-xs font-mono text-gray-500">{u.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Recent activity */}
          <Card title="Recent activity">
            {recentActivity.length === 0 ? <p className="text-xs text-gray-400">No activity recorded.</p> : (
              <ul className="space-y-1.5">
                {recentActivity.map(a => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-700 truncate">{a.eventType}</span>
                    <span className="text-gray-400 truncate max-w-[140px]">{a.actorEmail || a.actorRole}</span>
                    <span className="text-gray-300 flex-shrink-0">{ago(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Admin actions */}
          <Card title="Admin actions">
            <div className="space-y-2">
              <Link href={`/admin/dlr/dealers`} className="block w-full text-center px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">Open in DLR dealers</Link>
              <Link href={`/admin/dlr/messages`} className="block w-full text-center px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">Messages / replies</Link>
              {tenant.automationPaused ? (
                <ConfirmingForm
                  action={resumeDealerAction}
                  confirmMessage={`Resume automation for ${tenant.name}? Automated follow-ups may continue according to current settings.`}
                >
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <button type="submit" className="w-full px-3 py-1.5 text-xs font-semibold text-green-600 border border-green-200 rounded-lg hover:bg-green-50">Resume automation</button>
                </ConfirmingForm>
              ) : (
                <ConfirmingForm
                  action={pauseDealerAction}
                  confirmMessage={`Pause automation for ${tenant.name}? Automated follow-ups will stop until you resume.`}
                >
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <button type="submit" className="w-full px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50">Pause automation</button>
                </ConfirmingForm>
              )}
            </div>
          </Card>

          {/* Admin notes */}
          <Card title="Admin notes">
            <form action={addAdminNoteAction} className="space-y-2 mb-3">
              <input type="hidden" name="tenantId" value={tenant.id} />
              <textarea name="body" rows={3} placeholder="Internal note about this dealer…" className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
              <button type="submit" className="px-2.5 py-1 text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">Add note</button>
            </form>
            {notes.length === 0 ? <p className="text-xs text-gray-400">No notes.</p> : (
              <ul className="space-y-2">
                {notes.map(n => (
                  <li key={n.id} className="text-xs">
                    <p className="text-gray-700 whitespace-pre-wrap">{n.body}</p>
                    <p className="text-gray-400 mt-0.5">{n.authorEmail} · {n.createdAt.toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
      {children}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-800">{value}</dd>
    </div>
  )
}

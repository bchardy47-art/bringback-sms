/**
 * /admin/outreach/prospects/[id] — prospect detail.
 * All prospect info, eligibility, rendered preview, send history, notes, and
 * status actions. Send buttons are Brian-only; status/notes are admin.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { outreachNotes } from '@/lib/db/schema'
import { getAdminUser, isBrian } from '@/lib/admin/access'
import { trackEvent } from '@/lib/activity/track'
import { getProspect, statusLabel, statusChipClass } from '@/lib/outreach/queries'
import { recentSendsForProspect } from '@/lib/outreach/send'
import { evaluateEligibility } from '@/lib/outreach/eligibility'
import { getTemplateByKey, renderTemplate, ensureDefaultTemplates } from '@/lib/outreach/templates'
import { SendControls } from './SendControls'
import {
  setStatusAction, markDoNotContactAction, addProspectNoteAction,
} from '../../actions'

export const dynamic = 'force-dynamic'

const TEMPLATE_KEY = 'what_is_dlr'

export default async function ProspectDetailPage({ params }: { params: { id: string } }) {
  const user = await getAdminUser()
  if (!user) redirect('/login?callbackUrl=/admin/outreach')
  const brian = isBrian(user)

  await ensureDefaultTemplates()
  const prospect = await getProspect(params.id)
  if (!prospect) notFound()

  const [sends, notes, tpl] = await Promise.all([
    recentSendsForProspect(prospect.id),
    db.select().from(outreachNotes).where(eq(outreachNotes.prospectId, prospect.id)).orderBy(desc(outreachNotes.createdAt)),
    getTemplateByKey(TEMPLATE_KEY),
  ])

  // Cooldown-aware eligibility: a status='sent' send within 30d blocks.
  const now = new Date()
  const sentWithinCooldown = sends.some(s => s.status === 'sent' && s.createdAt >= new Date(now.getTime() - 30 * 864e5))
  const eligibility = evaluateEligibility(
    { id: prospect.id, dealershipName: prospect.dealershipName, publicEmail: prospect.publicEmail, sourceUrl: prospect.sourceUrl, status: prospect.status, archivedAt: prospect.archivedAt, doNotContactAt: prospect.doNotContactAt, nextEligibleAt: prospect.nextEligibleAt },
    { now, sentWithinCooldown },
  )

  const preview = tpl ? renderTemplate(tpl, prospect) : null
  await trackEvent('outreach_template_previewed', { actor: user, metadata: { prospectId: prospect.id, templateKey: TEMPLATE_KEY } })

  const fields: Array<[string, React.ReactNode]> = [
    ['City / State', [prospect.city, prospect.state].filter(Boolean).join(', ') || '—'],
    ['Website', prospect.website ? <a href={prospect.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{prospect.website}</a> : '—'],
    ['Main phone', prospect.mainPhone || '—'],
    ['Public email', prospect.publicEmail || <span className="text-orange-500">none</span>],
    ['Contact form', prospect.contactFormUrl ? <a href={prospect.contactFormUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">link</a> : '—'],
    ['Best contact', [prospect.bestContactName, prospect.bestContactTitle].filter(Boolean).join(' · ') || '—'],
    ['Source URL', prospect.sourceUrl ? <a href={prospect.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{prospect.sourceUrl}</a> : <span className="text-orange-500">missing</span>],
    ['Priority', prospect.priority],
    ['Personalization', prospect.personalizationLine || '—'],
    ['Fit notes', prospect.fitNotes || '—'],
    ['Source notes', prospect.sourceNotes || '—'],
    ['Last contacted', prospect.lastContactedAt ? prospect.lastContactedAt.toLocaleString() : '—'],
    ['Next eligible', prospect.nextEligibleAt ? prospect.nextEligibleAt.toLocaleString() : '—'],
  ]

  return (
    <div className="px-4 md:px-8 py-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <Link href="/admin/outreach" className="text-xs text-gray-500 hover:underline">← Outreach</Link>
        <div className="flex flex-wrap items-center gap-3 mt-1">
          <h1 className="text-2xl font-bold text-gray-900">{prospect.dealershipName}</h1>
          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusChipClass(prospect.status)}`}>{statusLabel(prospect.status)}</span>
          {eligibility.eligible
            ? <span className="text-xs font-semibold text-emerald-600">● eligible to send</span>
            : <span className="text-xs text-gray-500">○ {eligibility.detail}</span>}
        </div>
        {prospect.doNotContactAt && (
          <p className="text-xs text-red-600 mt-1">Do-not-contact set {prospect.doNotContactAt.toLocaleDateString()} — {prospect.doNotContactReason}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: details + preview */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Prospect</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {fields.map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-xs text-gray-400">{k}</dt>
                  <dd className="text-sm text-gray-800">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {preview && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Monthly demo invite preview</h2>
              <p className="text-xs text-gray-400 mb-3">Template: {tpl?.name}</p>
              <p className="text-xs text-gray-500 mb-1"><span className="font-semibold">Subject:</span> {preview.subject}</p>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100">{preview.text}</pre>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Send history</h2>
            {sends.length === 0 ? (
              <p className="text-xs text-gray-400">No sends yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-xs">
                {sends.map(s => (
                  <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                    <span className="text-gray-500">{s.createdAt.toLocaleString()}</span>
                    <span className="text-gray-700 truncate flex-1">{s.subject}</span>
                    <span className={`font-semibold ${s.status === 'sent' || s.status === 'test_sent' ? 'text-emerald-600' : s.status === 'failed' ? 'text-red-600' : 'text-gray-500'}`}>
                      {s.status}{s.skipReason ? ` · ${s.skipReason}` : ''}{s.failureReason ? ` · ${s.failureReason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="space-y-6">
          {brian ? (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Send</h2>
              <SendControls prospectId={prospect.id} templateKey={TEMPLATE_KEY} eligible={eligibility.eligible} eligibilityDetail={eligibility.detail} />
            </div>
          ) : (
            <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 p-5">
              <p className="text-xs text-gray-500">Sending is restricted to brian@dlr-sms.com. You can update status and notes.</p>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Status</h2>
            <div className="flex flex-wrap gap-1.5">
              {(['replied', 'interested', 'demo_booked', 'follow_up', 'not_interested', 'ready'] as const).map(s => (
                <form key={s} action={setStatusAction}>
                  <input type="hidden" name="prospectId" value={prospect.id} />
                  <input type="hidden" name="status" value={s} />
                  <button type="submit" className="px-2.5 py-1 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">
                    Mark {statusLabel(s).toLowerCase()}
                  </button>
                </form>
              ))}
              <form action={setStatusAction}>
                <input type="hidden" name="prospectId" value={prospect.id} />
                <input type="hidden" name="status" value="archived" />
                <button type="submit" className="px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">Archive</button>
              </form>
            </div>

            <form action={markDoNotContactAction} className="pt-2 border-t border-gray-100 space-y-2">
              <input type="hidden" name="prospectId" value={prospect.id} />
              <p className="text-xs font-semibold text-red-700">Do-not-contact</p>
              <input name="reason" placeholder="Reason (e.g. replied 'remove me')" className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
              <button type="submit" className="px-2.5 py-1 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
                Mark do-not-contact + suppress
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Notes</h2>
            <form action={addProspectNoteAction} className="space-y-2 mb-3">
              <input type="hidden" name="prospectId" value={prospect.id} />
              <textarea name="body" rows={2} placeholder="Add an internal note…" className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
              <button type="submit" className="px-2.5 py-1 text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">Add note</button>
            </form>
            {notes.length === 0 ? (
              <p className="text-xs text-gray-400">No notes.</p>
            ) : (
              <ul className="space-y-2">
                {notes.map(n => (
                  <li key={n.id} className="text-xs">
                    <p className="text-gray-700 whitespace-pre-wrap">{n.body}</p>
                    <p className="text-gray-400 mt-0.5">{n.authorEmail} · {n.createdAt.toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

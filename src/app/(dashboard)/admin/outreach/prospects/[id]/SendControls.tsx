'use client'

import { useState, useTransition } from 'react'
import { sendTestAction, sendInviteAction } from '../../actions'

// Brian-only send buttons. The server actions re-assert assertBrian(), so even
// if these were rendered for a non-Brian admin the action would reject — these
// are simply hidden for non-Brian to keep the UI honest.
export function SendControls({
  prospectId, templateKey, eligible, eligibilityDetail,
}: {
  prospectId: string
  templateKey: string
  eligible: boolean
  eligibilityDetail: string
}) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null)
  const [confirmInvite, setConfirmInvite] = useState(false)

  function fd(extra?: Record<string, string>) {
    const f = new FormData()
    f.set('prospectId', prospectId)
    f.set('templateKey', templateKey)
    Object.entries(extra ?? {}).forEach(([k, v]) => f.set(k, v))
    return f
  }

  function test() {
    setMsg(null)
    start(async () => {
      const r = await sendTestAction(fd())
      const reason = r && 'outcome' in r && r.outcome && !r.outcome.ok ? r.outcome.reason : undefined
      if (r?.ok) setMsg({ tone: 'good', text: 'Test email sent to brian@dlr-sms.com.' })
      else setMsg({ tone: 'bad', text: `Test not sent: ${reason || ('error' in (r ?? {}) ? r?.error : 'error') || 'error'}` })
    })
  }

  function invite() {
    setMsg(null)
    start(async () => {
      const r = await sendInviteAction(fd())
      const outcome = r && 'outcome' in r ? r.outcome : undefined
      const reason = outcome && !outcome.ok ? outcome.reason : undefined
      if (r?.ok && outcome?.kind === 'sent') setMsg({ tone: 'good', text: 'Monthly demo invite sent.' })
      else if (outcome?.kind === 'dry_run') setMsg({ tone: 'info', text: 'Dry-run logged (OUTREACH_SEND_ENABLED ≠ true). No real email sent.' })
      else setMsg({ tone: 'bad', text: `Skipped: ${reason || ('error' in (r ?? {}) ? r?.error : '') || 'not eligible'}` })
      setConfirmInvite(false)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={test} disabled={pending} className="px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          Send test to Brian
        </button>
        <button
          onClick={() => setConfirmInvite(true)}
          disabled={pending || !eligible}
          title={eligible ? 'Send the monthly demo invite' : eligibilityDetail}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send monthly demo invite
        </button>
      </div>

      {!eligible && <p className="text-xs text-gray-500">Not eligible: {eligibilityDetail}</p>}

      {confirmInvite && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
          <p className="text-xs text-red-800 font-semibold">Send the real monthly demo invite now?</p>
          <p className="text-xs text-red-700">Goes out only if OUTREACH_SEND_ENABLED=true; otherwise logged as a dry-run.</p>
          <div className="flex gap-2">
            <button onClick={invite} disabled={pending} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
              {pending ? 'Sending…' : 'Confirm send'}
            </button>
            <button onClick={() => setConfirmInvite(false)} disabled={pending} className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className={`text-xs font-medium ${msg.tone === 'good' ? 'text-emerald-600' : msg.tone === 'bad' ? 'text-red-600' : 'text-blue-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ChecklistItem } from '@/lib/intake/checklist'
import { STATUS_DOT } from '@/lib/intake/checklist'
import {
  mark10dlcPending,
  mark10dlcApproved,
  provisionTenant,
  saveAdminNotes,
} from './actions'

// ── Checklist ─────────────────────────────────────────────────────────────────

export function ChecklistPanel({
  items,
  intakeId,
  intakeToken,
}: {
  items: ChecklistItem[]
  intakeId: string
  intakeToken: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [provision, setProvision] = useState<{
    adminEmail: string
    tempPassword: string
    loginUrl: string
  } | null>(null)
  const [err, setErr] = useState('')

  const doneCount = items.filter(i => i.status === 'done').length

  async function handleAction(actionKey: string) {
    setLoading(actionKey)
    setErr('')
    try {
      if (actionKey === 'mark10dlcPending') {
        await mark10dlcPending(intakeId)
        router.refresh()
      } else if (actionKey === 'mark10dlcApproved') {
        await mark10dlcApproved(intakeId)
        router.refresh()
      } else if (actionKey === 'provisionTenant') {
        const result = await provisionTenant(intakeId)
        setProvision(result)
        router.refresh()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setLoading(null)
    }
  }

  const intakeUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/intake/${intakeToken}`
    : `/intake/${intakeToken}`

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-500">
            {doneCount} of {items.length} steps complete
          </span>
          <span className="text-xs text-gray-400">{Math.round((doneCount / items.length) * 100)}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${(doneCount / items.length) * 100}%`, backgroundColor: '#dc2626' }}
          />
        </div>
      </div>

      {/* Intake form link */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
        <p className="text-xs font-semibold text-gray-500 mb-1">Intake form link (send to dealer)</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs text-gray-700 bg-white border border-gray-200 rounded px-2 py-1.5 truncate">
            {intakeUrl}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(intakeUrl)}
            className="text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1.5 rounded border border-red-200 hover:bg-red-50 transition-colors whitespace-nowrap"
          >
            Copy
          </button>
        </div>
      </div>

      {/* Provision result — shown once after creating tenant */}
      {provision && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-bold text-emerald-800">✅ Tenant provisioned</p>
          <div className="space-y-1.5">
            <div>
              <p className="text-xs font-semibold text-emerald-700">Login URL</p>
              <code className="text-xs text-emerald-900">{provision.loginUrl}</code>
            </div>
            <div>
              <p className="text-xs font-semibold text-emerald-700">Admin email</p>
              <code className="text-xs text-emerald-900">{provision.adminEmail}</code>
            </div>
            <div>
              <p className="text-xs font-semibold text-emerald-700">Temp password (shown once — copy now)</p>
              <div className="flex items-center gap-2 mt-0.5">
                <code className="text-sm font-bold text-emerald-900 bg-white border border-emerald-300 rounded px-2 py-1">
                  {provision.tempPassword}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(provision.tempPassword)}
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-emerald-600">
            Send these credentials to the dealer manually. The password will not be shown again.
          </p>
        </div>
      )}

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-xs text-red-700">{err}</p>
        </div>
      )}

      {/* Checklist items */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {items.map((item, i) => (
          <div
            key={item.key}
            className="flex items-start gap-3 px-4 py-4"
            style={i < items.length - 1 ? { borderBottom: '1px solid #f3f4f6' } : undefined}
          >
            <div className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_DOT[item.status]}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${
                item.status === 'blocked' ? 'text-gray-400' : 'text-gray-800'
              }`}>
                {item.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{item.description}</p>
            </div>
            {item.action && (
              <div className="flex-shrink-0">
                {item.action.type === 'link' ? (
                  <a
                    href={item.action.href}
                    target={item.action.href?.startsWith('http') ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-red-600 hover:text-red-700 whitespace-nowrap"
                  >
                    {item.action.label}
                  </a>
                ) : (
                  <button
                    onClick={() => handleAction(item.action!.actionKey!)}
                    disabled={loading === item.action.actionKey}
                    className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    style={{ backgroundColor: '#dc2626' }}
                  >
                    {loading === item.action.actionKey ? 'Working…' : item.action.label}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Admin notes ───────────────────────────────────────────────────────────────

export function AdminNotesPanel({
  intakeId,
  initialNotes,
}: {
  intakeId: string
  initialNotes: string | null
}) {
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    await saveAdminNotes(intakeId, notes)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Admin Notes</p>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={5}
        placeholder="Internal notes about this dealer's setup, conversations, blockers…"
        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-red-500 text-gray-700 placeholder-gray-400"
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 px-3 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-50 transition-colors"
        style={{ backgroundColor: '#374151' }}
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Notes'}
      </button>
    </div>
  )
}

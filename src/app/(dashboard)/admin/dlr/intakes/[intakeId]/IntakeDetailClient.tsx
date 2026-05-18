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

// Telnyx portal entry points. The campaigns view is where TCR campaign
// submission lives; ops typically navigate from there to brand/campaign
// detail. Hard-coded because they don't vary per tenant.
const TELNYX_10DLC_URL = 'https://portal.telnyx.com/#/messaging-10dlc/campaigns/new'

// ── Generic copy-to-clipboard button ──────────────────────────────────────────

export function CopyButton({
  text,
  label = 'Copy',
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className={
        className ??
        'text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded border border-red-200 hover:bg-red-50 transition-colors whitespace-nowrap'
      }
    >
      {copied ? '✓ Copied' : label}
    </button>
  )
}

// ── Operator-summary copy button (Operator Command Center) ────────────────────
//
// Builds the standard 4-line operator status summary lazily on click so the
// caller can pass plain props (dealership name + intake id + status label +
// next-step label) rather than constructing the multi-line string up-front
// in a server component. The shape matches buildOperatorSummary() in
// src/lib/intake/operator-status.ts but we duplicate the few lines here
// to avoid a server-only import landing in a client bundle.

export function CopySummaryButton({
  dealershipName,
  intakeId,
  statusLabel,
  nextStepLabel,
  adminBaseUrl,
}: {
  dealershipName: string
  intakeId:       string
  statusLabel:    string
  nextStepLabel:  string
  adminBaseUrl?:  string
}) {
  const [copied, setCopied] = useState(false)

  function onClick() {
    const base = adminBaseUrl
      ?? (typeof window !== 'undefined' ? window.location.origin : 'https://dlr-sms.com')
    const text = [
      `Dealer: ${dealershipName}`,
      `Status: ${statusLabel}`,
      `Next step: ${nextStepLabel}`,
      `Admin URL: ${base}/admin/dlr/intakes/${intakeId}`,
    ].join('\n')
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 px-2.5 py-1 rounded transition-colors whitespace-nowrap"
    >
      {copied ? '✓ Copied' : 'Copy next-step summary'}
    </button>
  )
}

// ── External link button (e.g. dealer website) ────────────────────────────────

export function ExternalLinkButton({
  href,
  label,
}: {
  href: string
  label?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline break-all"
    >
      {label ?? href} ↗
    </a>
  )
}

// ── 10DLC submit action block — shown above the checklist when pending ───────

export function TenDlcSubmitActions({
  intakeId,
  compliancePacket,
  initialReference,
}: {
  intakeId: string
  compliancePacket: string
  initialReference: string | null
}) {
  const router = useRouter()
  const [reference, setReference] = useState(initialReference ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit() {
    setSubmitting(true)
    setErr('')
    try {
      await mark10dlcPending(intakeId, reference)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to mark submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-blue-900">Ready to submit 10DLC</p>
          <p className="text-xs text-blue-800 mt-0.5">
            Open the Telnyx portal, paste the compliance packet into your brand/campaign
            submission, then mark this step submitted (optionally with the TCR reference).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={TELNYX_10DLC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
        >
          Open Telnyx 10DLC ↗
        </a>
        <CopyButton
          text={compliancePacket}
          label="Copy compliance packet"
          className="text-xs font-semibold text-blue-700 bg-white border border-blue-300 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={reference}
          onChange={e => setReference(e.target.value)}
          placeholder="TCR campaign ID, brand ID, or note (optional)"
          className="flex-1 min-w-[14rem] text-sm px-2.5 py-1.5 rounded-lg border border-blue-200 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
          style={{ backgroundColor: '#dc2626' }}
        >
          {submitting ? 'Saving…' : 'Mark as submitted'}
        </button>
      </div>

      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  )
}

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

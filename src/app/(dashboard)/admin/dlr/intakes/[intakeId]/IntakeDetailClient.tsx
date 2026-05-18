'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ChecklistItem } from '@/lib/intake/checklist'
import { STATUS_DOT } from '@/lib/intake/checklist'
import type {
  IntakeAudit,
  PacketSections,
} from '@/lib/intake/tendlc-copilot'
import {
  mark10dlcPending,
  mark10dlcApproved,
  provisionTenant,
  saveAdminNotes,
} from './actions'

// Telnyx portal entry point. The campaigns view is where TCR campaign
// submission lives; ops navigate from there to brand/campaign detail.
// Used by TenDlcCopilotPanel below.
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

// ── 10DLC Submission Copilot panel ────────────────────────────────────────────
//
// Read-only audit + copy-ready submission packet. Does NOT submit anything
// to Telnyx or TCR. The "Mark as submitted" action at the bottom is the
// existing `mark10dlcPending` server action — same one the previous
// TenDlcSubmitActions block used — surfaced here so the operator's full
// flow (audit → copy → paste in Telnyx → submit + pay there → return to
// DLR and mark submitted with optional TCR reference) lives in one panel.

const READINESS_STYLE: Record<
  IntakeAudit['readiness'],
  { chip: string; banner: string; title: string }
> = {
  ready: {
    chip:   'bg-emerald-100 text-emerald-700',
    banner: 'border-emerald-200 bg-emerald-50',
    title:  'Ready for human review',
  },
  high_risk: {
    chip:   'bg-amber-100 text-amber-800',
    banner: 'border-amber-300 bg-amber-50',
    title:  'High rejection risk',
  },
  needs_fixes: {
    chip:   'bg-red-100 text-red-700',
    banner: 'border-red-300 bg-red-50',
    title:  'Needs fixes',
  },
}

export function TenDlcCopilotPanel({
  intakeId,
  audit,
  sections,
  fullPacket,
  campaignNarrative,
  sampleMessagesBlock,
  initialReference,
}: {
  intakeId:            string
  audit:               IntakeAudit
  sections:            PacketSections
  fullPacket:          string
  campaignNarrative:   string
  sampleMessagesBlock: string
  initialReference:    string | null
}) {
  const router = useRouter()
  const [reference, setReference] = useState(initialReference ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  const style = READINESS_STYLE[audit.readiness]

  async function handleMarkSubmitted() {
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
    <div className={`rounded-xl border-2 ${style.banner} p-4 space-y-4`}>
      {/* ── Header: readiness verdict + top action bar ─────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
            10DLC Submission Copilot
          </p>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-gray-900">{style.title}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${style.chip}`}>
              {audit.readiness === 'ready' ? '✓ ready'
                : audit.readiness === 'high_risk' ? '⚠ high risk'
                : '✗ needs fixes'}
            </span>
          </div>
          <p className="text-sm text-gray-700 mt-1 max-w-2xl">{audit.summary}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <CopyButton
            text={fullPacket}
            label="Copy full packet"
            className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          />
          <a
            href={TELNYX_10DLC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-gray-800 bg-white border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            Open Telnyx 10DLC ↗
          </a>
        </div>
      </div>

      {/* ── Audit checks + risk flags ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Audit checks ({audit.checks.filter(c => c.passed).length}/{audit.checks.length} passed)
          </p>
          <ul className="space-y-1.5">
            {audit.checks.map(check => (
              <li key={check.key} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 inline-flex w-3.5 h-3.5 rounded-full items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                  check.passed ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                }`}>
                  {check.passed ? '✓' : '✗'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`font-medium ${check.passed ? 'text-gray-800' : 'text-red-700'}`}>
                    {check.label}
                  </p>
                  <p className="text-gray-500 leading-snug">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Risk flags ({audit.risks.length})
          </p>
          {audit.risks.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No carrier-rejection risks detected.</p>
          ) : (
            <ul className="space-y-1.5">
              {audit.risks.map(risk => (
                <li key={risk.key} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 inline-flex w-3.5 h-3.5 rounded-full items-center justify-center text-[9px] font-bold flex-shrink-0 bg-amber-500 text-white">
                    !
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-amber-800">{risk.label}</p>
                    <p className="text-gray-500 leading-snug">{risk.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Section copy buttons ───────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Copy-ready packet sections
        </p>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={sections.brand}              label="Brand info"      className={SECTION_BTN} />
          <CopyButton text={sections.contacts}           label="Contact info"    className={SECTION_BTN} />
          <CopyButton text={campaignNarrative}           label="Campaign narrative" className={SECTION_BTN} />
          <CopyButton text={sampleMessagesBlock}         label="Sample messages" className={SECTION_BTN} />
          <CopyButton text={sections.internal}           label="Internal notes"  className={SECTION_BTN} />
        </div>

        {/* Preview accordion — collapsed by default to keep panel compact */}
        <details className="mt-3">
          <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-900 select-none">
            Preview full packet text
          </summary>
          <pre className="mt-2 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-72 whitespace-pre-wrap">
{fullPacket}
          </pre>
        </details>
      </div>

      {/* ── Mark as submitted (the only mutation in this panel) ────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          After submitting in Telnyx, return here:
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder="TCR campaign ID, brand ID, or note (optional)"
            className="flex-1 min-w-[14rem] text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <button
            type="button"
            onClick={handleMarkSubmitted}
            disabled={submitting || audit.readiness === 'needs_fixes'}
            title={
              audit.readiness === 'needs_fixes'
                ? 'Required fields are missing. Fix the audit checks above before marking submitted.'
                : 'Mark this intake as submitted to TCR.'
            }
            className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
            style={{ backgroundColor: '#dc2626' }}
          >
            {submitting ? 'Saving…' : 'Mark as submitted'}
          </button>
        </div>
        {err && <p className="text-xs text-red-700">{err}</p>}
      </div>
    </div>
  )
}

const SECTION_BTN = 'text-xs font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 px-2.5 py-1 rounded transition-colors whitespace-nowrap'

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

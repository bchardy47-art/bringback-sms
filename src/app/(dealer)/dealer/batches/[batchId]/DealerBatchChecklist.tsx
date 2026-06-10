'use client'

/**
 * DealerBatchChecklist
 *
 * Dealer-facing pre-approval checklist. Once all items are confirmed AND
 * the final approval attestation is ticked, the dealer can approve the
 * batch. Approval does NOT send messages — live sending requires a
 * separate admin-side gate (10DLC approval).
 *
 * Compliance (C-2):
 *   - The final emerald attestation block below the checklist is a
 *     compliance gate, not a pre-flight checklist item. Ticking it
 *     causes the server action to write a compliance_attestations row
 *     before flipping pilot_batches.status to 'approved'.
 *   - The exact text shown to the dealer is the source of truth for
 *     CAMPAIGN_APPROVAL_TEXT in src/lib/compliance/attestation-text.ts.
 *     If you edit one, edit the other (and bump CAMPAIGN_APPROVAL_VERSION).
 */

import { useState, useTransition } from 'react'
import { approveDealerBatch } from './actions'
import { CAMPAIGN_APPROVAL_TEXT } from '@/lib/compliance/attestation-text'

type Props = {
  batchId:    string
  totalLeads: number
}

export function DealerBatchChecklist({ batchId, totalLeads }: Props) {
  const checkItems = [
    'All leads have confirmed or documented SMS consent',
    'I have reviewed the message previews and they look accurate',
    'No leads have opted out or revoked consent',
    'Fallback message copy (for leads without a vehicle on file) is acceptable',
    'Each message sequence includes an opt-out instruction',
    `This starter campaign includes ${totalLeads} lead${totalLeads === 1 ? '' : 's'} so DLR can walk through launch with you`,
  ]

  const [checked,  setChecked]  = useState<boolean[]>(checkItems.map(() => false))
  const [attested, setAttested] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const allChecked   = checked.every(Boolean)
  const checkedCount = checked.filter(Boolean).length
  // Both gates must pass: pre-flight checklist AND the final approval
  // attestation. Either alone is insufficient.
  const canApprove = allChecked && attested

  function toggle(i: number) {
    setChecked(prev => prev.map((v, j) => (j === i ? !v : v)))
  }

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      try {
        await approveDealerBatch(batchId, { attested: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      }
    })
  }

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-sm font-black text-white">Ready to Approve This Campaign?</h2>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Confirm each item below, then approve. Approving does <strong className="text-white">not</strong> send messages —
          that requires a final activation step that we complete together.
        </p>
      </div>

      <div className="space-y-2 text-sm">
        {checkItems.map((item, i) => (
          <label key={i} className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={() => toggle(i)}
              className="mt-0.5 h-4 w-4 rounded cursor-pointer accent-red-500"
              style={{ accentColor: '#ff1b1b' }}
            />
            <span style={{
              color: checked[i] ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)',
              textDecoration: checked[i] ? 'line-through' : 'none',
              textDecorationColor: 'rgba(255,255,255,0.2)',
            }}>
              {item}
            </span>
          </label>
        ))}
      </div>

      {/* ── C-2: Final approval attestation ────────────────────────────────
          A signed audit row is written before the status flip. The exact
          text the dealer ticks here is mirrored in
          CAMPAIGN_APPROVAL_TEXT — bump the version if you change either. */}
      <label
        className="flex items-start gap-3 cursor-pointer rounded-lg px-4 py-3 transition-colors"
        style={{
          background: attested ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.08)',
          border: attested ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(245,158,11,0.35)',
        }}
      >
        <input
          type="checkbox"
          checked={attested}
          onChange={(e) => setAttested(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded cursor-pointer shrink-0"
          style={{ accentColor: attested ? '#10b981' : '#f59e0b' }}
        />
        <div className="text-sm">
          <p
            className="font-bold"
            style={{ color: attested ? '#34d399' : '#fbbf24' }}
          >
            {attested ? '✓ Approval attestation confirmed' : 'Final approval attestation required'}
          </p>
          <p className="mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {CAMPAIGN_APPROVAL_TEXT}
          </p>
        </div>
      </label>

      <div className="space-y-2">
        {!canApprove && (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {checkedCount} of {checkItems.length} items confirmed
            {!attested && ' · final attestation required'}
          </p>
        )}

        {error && (
          <p className="text-xs font-medium" style={{ color: '#f87171' }}>{error}</p>
        )}

        {canApprove ? (
          <button
            onClick={handleApprove}
            disabled={isPending}
            className="dlr-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? 'Approving…' : 'Approve this campaign →'}
          </button>
        ) : (
          <button
            disabled
            className="px-5 py-2.5 rounded-lg text-sm font-bold cursor-not-allowed"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.25)',
            }}
            title="Confirm all items + tick the final attestation to approve"
          >
            Approve this campaign →
          </button>
        )}

        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
          After approval, our team will complete final carrier verification before any messages are sent.
        </p>
      </div>
    </div>
  )
}

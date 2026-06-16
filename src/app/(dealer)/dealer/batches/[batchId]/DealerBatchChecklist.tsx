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
    <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Section header */}
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-hi)' }}>
          Ready to Approve This Campaign?
        </p>
        <p style={{ fontSize: 12, color: 'var(--tx-mid)', marginTop: 3, lineHeight: 1.55 }}>
          Confirm each item below, then approve. Approving does <strong style={{ color: 'var(--tx-hi)' }}>not</strong> send messages —
          your campaign stays paused until launch is turned on.
        </p>
      </div>

      {/* Checklist items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {checkItems.map((item, i) => (
          <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={() => toggle(i)}
              style={{ marginTop: 2, width: 15, height: 15, cursor: 'pointer', accentColor: '#4ade80', flexShrink: 0 }}
            />
            <span style={{
              fontSize: 13,
              color: checked[i] ? 'var(--tx-lo)' : 'var(--tx)',
              textDecoration: checked[i] ? 'line-through' : 'none',
              lineHeight: 1.45,
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
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
          borderRadius: 10, padding: '12px 14px',
          border: attested ? '1px solid rgba(34,197,94,0.35)'  : '1px solid rgba(245,158,11,0.35)',
          background: attested ? 'rgba(34,197,94,0.07)'        : 'rgba(245,158,11,0.07)',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <input
          type="checkbox"
          checked={attested}
          onChange={(e) => setAttested(e.target.checked)}
          style={{ marginTop: 2, width: 15, height: 15, cursor: 'pointer', accentColor: '#4ade80', flexShrink: 0 }}
        />
        <div>
          <p style={{
            fontSize: 13, fontWeight: 600,
            color: attested ? '#4ade80' : '#fbbf24',
            marginBottom: 4,
          }}>
            {attested ? '✓ Approval attestation confirmed' : 'Final approval attestation required'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--tx-mid)', lineHeight: 1.55 }}>
            {CAMPAIGN_APPROVAL_TEXT}
          </p>
        </div>
      </label>

      {/* Progress / approve button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!canApprove && (
          <p style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
            {checkedCount} of {checkItems.length} items confirmed
            {!attested && ' · final attestation required'}
          </p>
        )}

        {error && (
          <p style={{ fontSize: 12, color: '#ff8a7a', fontWeight: 500 }}>{error}</p>
        )}

        {canApprove ? (
          <button
            onClick={handleApprove}
            disabled={isPending}
            style={{
              alignSelf: 'flex-start',
              padding: '9px 20px',
              borderRadius: 8,
              border: '1px solid rgba(34,197,94,0.4)',
              background: 'rgba(34,197,94,0.12)',
              color: '#4ade80',
              fontSize: 13, fontWeight: 700,
              cursor: isPending ? 'not-allowed' : 'pointer',
              opacity: isPending ? 0.5 : 1,
              transition: 'background 0.15s',
            }}
          >
            {isPending ? 'Approving…' : 'Approve this campaign →'}
          </button>
        ) : (
          <button
            disabled
            title="Confirm all items + tick the final attestation to approve"
            style={{
              alignSelf: 'flex-start',
              padding: '9px 20px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(255,255,255,0.04)',
              color: 'var(--tx-lo)',
              fontSize: 13, fontWeight: 700,
              cursor: 'not-allowed',
            }}
          >
            Approve this campaign →
          </button>
        )}

        <p style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
          After approval, your campaign remains paused until launch is turned on.
        </p>
      </div>
    </div>
  )
}

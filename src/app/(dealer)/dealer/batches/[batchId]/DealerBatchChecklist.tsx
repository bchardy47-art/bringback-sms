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
    <div className="border-2 border-blue-200 rounded-xl overflow-hidden">
      <div className="bg-blue-50 px-5 py-3 border-b border-blue-200">
        <h2 className="text-sm font-semibold text-blue-900">Ready to Approve This Campaign?</h2>
        <p className="text-xs text-blue-700 mt-0.5">
          Confirm each item below, then approve. Approving does <strong>not</strong> send messages —
          that requires a final activation step that we complete together.
        </p>
      </div>

      <div className="px-5 py-4 space-y-2 text-sm text-gray-700">
        {checkItems.map((item, i) => (
          <label key={i} className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={() => toggle(i)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer"
            />
            <span className={checked[i] ? 'text-gray-400 line-through' : 'text-gray-700'}>
              {item}
            </span>
          </label>
        ))}
      </div>

      {/* ── C-2: Final approval attestation ────────────────────────────────
          A signed audit row is written before the status flip. The exact
          text the dealer ticks here is mirrored in
          CAMPAIGN_APPROVAL_TEXT — bump the version if you change either. */}
      <div className="px-5 pb-4">
        <label
          className={`flex items-start gap-3 cursor-pointer rounded-lg border px-4 py-3 transition-colors ${
            attested
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-amber-200 bg-amber-50'
          }`}
        >
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 cursor-pointer shrink-0"
          />
          <div className="text-sm">
            <p className={`font-semibold ${attested ? 'text-emerald-900' : 'text-amber-900'}`}>
              {attested ? '✓ Approval attestation confirmed' : 'Final approval attestation required'}
            </p>
            <p className="text-gray-700 mt-0.5 leading-relaxed">
              {CAMPAIGN_APPROVAL_TEXT}
            </p>
          </div>
        </label>
      </div>

      <div className="px-5 pb-5 space-y-2">
        {!canApprove && (
          <p className="text-xs text-gray-400">
            {checkedCount} of {checkItems.length} items confirmed
            {!attested && ' · final attestation required'}
          </p>
        )}

        {error && (
          <p className="text-xs text-red-600 font-medium">{error}</p>
        )}

        {canApprove ? (
          <button
            onClick={handleApprove}
            disabled={isPending}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? 'Approving…' : 'Approve this campaign →'}
          </button>
        ) : (
          <button
            disabled
            className="px-5 py-2.5 bg-gray-200 text-gray-400 text-sm font-bold rounded-lg cursor-not-allowed"
            title="Confirm all items + tick the final attestation to approve"
          >
            Approve this campaign →
          </button>
        )}

        <p className="text-xs text-gray-400">
          After approval, our team will complete final carrier verification before any messages are sent.
        </p>
      </div>
    </div>
  )
}

'use client'

/**
 * DealerBatchChecklist
 *
 * Dealer-facing pre-approval checklist. Once all items are confirmed
 * the dealer can approve the batch. Approval does NOT send messages —
 * live sending requires a separate admin-side gate (10DLC approval).
 */

import { useState, useTransition } from 'react'
import { approveDealerBatch } from './actions'

type Props = {
  batchId:    string
  totalLeads: number
  maxLeads:   number
}

export function DealerBatchChecklist({ batchId, totalLeads, maxLeads }: Props) {
  const checkItems = [
    'All leads have confirmed or implied SMS consent',
    'I have reviewed the message previews and they look accurate',
    'No leads have opted out or revoked consent',
    'Fallback message copy (for leads without a vehicle on file) is acceptable',
    'Each message sequence includes an opt-out instruction',
    `Lead count is within the pilot limit of ${maxLeads} (current: ${totalLeads})`,
  ]

  const [checked, setChecked] = useState<boolean[]>(checkItems.map(() => false))
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const allChecked  = checked.every(Boolean)
  const checkedCount = checked.filter(Boolean).length

  function toggle(i: number) {
    setChecked(prev => prev.map((v, j) => (j === i ? !v : v)))
  }

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      try {
        await approveDealerBatch(batchId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      }
    })
  }

  return (
    <div className="border-2 border-blue-200 rounded-xl overflow-hidden">
      <div className="bg-blue-50 px-5 py-3 border-b border-blue-200">
        <h2 className="text-sm font-semibold text-blue-900">Ready to Approve This Batch?</h2>
        <p className="text-xs text-blue-700 mt-0.5">
          Confirm each item below, then approve. Approving does <strong>not</strong> send messages —
          that requires a live-send activation step that we complete together.
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

      <div className="px-5 pb-5 space-y-2">
        {!allChecked && (
          <p className="text-xs text-gray-400">
            {checkedCount} of {checkItems.length} items confirmed
          </p>
        )}

        {error && (
          <p className="text-xs text-red-600 font-medium">{error}</p>
        )}

        {allChecked ? (
          <button
            onClick={handleApprove}
            disabled={isPending}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? 'Approving…' : 'Approve this batch →'}
          </button>
        ) : (
          <button
            disabled
            className="px-5 py-2.5 bg-gray-200 text-gray-400 text-sm font-bold rounded-lg cursor-not-allowed"
            title="Confirm all items above to approve"
          >
            Approve this batch →
          </button>
        )}

        <p className="text-xs text-gray-400">
          After approval, our team will complete final 10DLC verification before any messages are sent.
        </p>
      </div>
    </div>
  )
}

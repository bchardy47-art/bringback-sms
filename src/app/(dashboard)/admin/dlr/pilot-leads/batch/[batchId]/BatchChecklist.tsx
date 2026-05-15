'use client'

/**
 * BatchChecklist
 *
 * Gated pre-approval checklist for the Pilot Batch Review page.
 * The "Proceed to live send approval" button stays disabled until
 * every checklist item is checked. No network calls — pure UI state.
 */

import { useState } from 'react'

type Props = {
  batchId:    string
  totalLeads: number
  maxLeads:   number
}

export function BatchChecklist({ batchId, totalLeads, maxLeads }: Props) {
  const checkItems = [
    'All leads have confirmed or implied SMS consent',
    'Message templates have been reviewed and look accurate',
    'No leads have opted out or revoked consent',
    'Fallback templates (if used) are acceptable for leads without a vehicle on file',
    'The workflow includes an opt-out instruction on at least one message',
    `Lead count does not exceed ${maxLeads} (current: ${totalLeads})`,
    '10DLC registration is approved or in progress before live sending',
  ]

  const [checked, setChecked] = useState<boolean[]>(checkItems.map(() => false))
  const allChecked = checked.every(Boolean)
  const checkedCount = checked.filter(Boolean).length

  function toggle(i: number) {
    setChecked(prev => prev.map((v, j) => (j === i ? !v : v)))
  }

  return (
    <div className="border-2 border-amber-200 rounded-xl overflow-hidden">
      <div className="bg-amber-50 px-5 py-3 border-b border-amber-200">
        <h2 className="text-sm font-semibold text-amber-900">Pre-Approval Checklist</h2>
        <p className="text-xs text-amber-700 mt-0.5">
          Check all items before proceeding. Approval does{' '}
          <strong>not</strong> send messages — live sending requires a separate approval step.
        </p>
      </div>

      <div className="px-5 py-4 space-y-2 text-sm text-gray-700">
        {checkItems.map((item, i) => (
          <label
            key={i}
            className="flex items-start gap-3 cursor-pointer group"
          >
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
        {/* Progress indicator */}
        {!allChecked && (
          <p className="text-xs text-gray-400">
            {checkedCount} of {checkItems.length} items confirmed
          </p>
        )}

        {allChecked ? (
          <a
            href={`/admin/dlr/pilot?batchId=${batchId}`}
            className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-colors"
          >
            Proceed to live send approval →
          </a>
        ) : (
          <button
            disabled
            className="px-5 py-2.5 bg-gray-200 text-gray-400 text-sm font-bold rounded-lg cursor-not-allowed"
            title="Check all items above to proceed"
          >
            Proceed to live send approval →
          </button>
        )}

        <p className="text-xs text-gray-400">
          You will confirm the send phrase and review leads one final time before any SMS is sent.
        </p>
      </div>
    </div>
  )
}

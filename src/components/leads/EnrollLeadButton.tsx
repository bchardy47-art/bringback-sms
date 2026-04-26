'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Workflow {
  id: string
  name: string
  isActive: boolean
}

export function EnrollLeadButton({
  leadId,
  workflows,
}: {
  leadId: string
  workflows: Workflow[]
}) {
  const [workflowId, setWorkflowId] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()

  const activeWorkflows = workflows.filter((w) => w.isActive)

  async function handleEnroll() {
    if (!workflowId) return
    setEnrolling(true)
    setMessage(null)

    const res = await fetch(`/api/leads/${leadId}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId }),
    })

    const data = await res.json()
    setEnrolling(false)

    if (res.ok) {
      setMessage({ type: 'success', text: 'Enrolled successfully.' })
      router.refresh()
    } else if (res.status === 409) {
      setMessage({ type: 'error', text: `Not enrolled: ${data.skipped ?? 'conflict'}` })
    } else {
      setMessage({ type: 'error', text: data.error ?? 'Enrollment failed.' })
    }
  }

  if (activeWorkflows.length === 0) {
    return <p className="text-xs text-gray-400">No active workflows available.</p>
  }

  return (
    <div className="space-y-2">
      <select
        value={workflowId}
        onChange={(e) => setWorkflowId(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">Select workflow…</option>
        {activeWorkflows.map((wf) => (
          <option key={wf.id} value={wf.id}>
            {wf.name}
          </option>
        ))}
      </select>

      <button
        onClick={handleEnroll}
        disabled={!workflowId || enrolling}
        className="w-full px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {enrolling ? 'Enrolling…' : 'Enroll'}
      </button>

      {message && (
        <p className={`text-xs ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}

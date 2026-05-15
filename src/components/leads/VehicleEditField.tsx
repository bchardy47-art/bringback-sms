'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

export function VehicleEditField({
  leadId,
  initialValue,
}: {
  leadId: string
  initialValue: string | null | undefined
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialValue ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function startEdit() {
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleOfInterest: value.trim() || null }),
      })
      setEditing(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') {
      setValue(initialValue ?? '')
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 text-sm py-0.5">
        <span className="text-gray-500 shrink-0">Vehicle</span>
        <div className="flex items-center gap-1 ml-auto">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. 2022 Toyota Camry"
            disabled={saving}
            autoFocus
            className="w-44 rounded border border-blue-400 px-2 py-0.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={save}
            disabled={saving}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
          >
            {saving ? '…' : 'Save'}
          </button>
          <button
            onClick={() => { setValue(initialValue ?? ''); setEditing(false) }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-between items-center text-sm py-0.5 group">
      <span className="text-gray-500">Vehicle</span>
      <div className="flex items-center gap-1">
        <span className="text-gray-900 font-medium">
          {value || '—'}
        </span>
        <button
          onClick={startEdit}
          className="opacity-0 group-hover:opacity-100 text-xs text-blue-500 hover:text-blue-700 transition-opacity"
          title="Edit vehicle"
        >
          edit
        </button>
      </div>
    </div>
  )
}

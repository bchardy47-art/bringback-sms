'use client'

/**
 * Phase 14 — Pilot Lead Import Form (client component)
 *
 * Supports two import modes:
 *   1. CSV file upload — drag-drop or file picker
 *   2. Manual single-lead entry form
 *
 * Posts to POST /api/admin/dlr/pilot-leads/import
 * After a successful import, reloads the page to show results.
 */

import { useState, useRef } from 'react'

type Props = {
  tenantId: string
}

type ImportResult = {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  phoneRaw: string
  importStatus: string
  blockedReasons: string[]
  warnings: string[]
}

type ImportResponse = {
  ok: boolean
  count: number
  eligible: number
  warned: number
  blocked: number
  results: ImportResult[]
  error?: string
}

const CONSENT_OPTIONS = [
  { value: 'explicit',  label: 'Explicit — customer opted in directly' },
  { value: 'implied',   label: 'Implied — inferred from inquiry context' },
  { value: 'unknown',   label: 'Unknown — not captured' },
  { value: 'revoked',   label: 'Revoked — customer asked to stop' },
]

export function ImportForm({ tenantId }: Props) {
  const [mode, setMode]           = useState<'csv' | 'manual'>('csv')
  const [loading, setLoading]     = useState(false)
  const [result, setResult]       = useState<ImportResponse | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const fileRef                   = useRef<HTMLInputElement>(null)

  // Manual form state
  const [manual, setManual] = useState({
    firstName:         '',
    lastName:          '',
    phone:             '',
    email:             '',
    vehicleName:       '',
    leadSource:        '',
    originalInquiryAt: '',
    consentStatus:     'unknown',
    consentSource:     '',
    consentCapturedAt: '',
    smsConsentNotes:   '',
    notes:             '',
  })

  // ── CSV import ───────────────────────────────────────────────────────────────
  async function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const csv = await file.text()
    await submitImport({ csv })
  }

  async function handleCSVPaste(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const csv  = (form.elements.namedItem('csvText') as HTMLTextAreaElement).value
    if (!csv.trim()) return
    await submitImport({ csv })
  }

  // ── Manual import ────────────────────────────────────────────────────────────
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submitImport({ rows: [{ ...manual, vehicleName: manual.vehicleName || null }] })
  }

  // ── Shared submit ────────────────────────────────────────────────────────────
  async function submitImport(payload: Record<string, unknown>) {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/admin/dlr/pilot-leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...payload }),
      })
      const data = await res.json() as ImportResponse

      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Import failed')
        return
      }
      setResult(data)
      // Reload after a short pause so the table updates
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        {(['csv', 'manual'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              mode === m
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {m === 'csv' ? '📄 CSV Upload' : '✏️ Manual Entry'}
          </button>
        ))}
      </div>

      {/* CSV mode */}
      {mode === 'csv' && (
        <div className="space-y-3">
          {/* File picker */}
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-lg px-6 py-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
          >
            <p className="text-sm font-medium text-gray-700">Click to upload a CSV file</p>
            <p className="text-xs text-gray-400 mt-1">
              Columns: firstName, lastName, phone, email, vehicleName, leadSource,
              originalInquiryAt, consentStatus, consentSource, consentCapturedAt, notes
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleCSVUpload}
            />
          </div>

          {/* Paste area */}
          <p className="text-xs text-gray-400 text-center">— or paste CSV below —</p>
          <form onSubmit={handleCSVPaste} className="space-y-2">
            <textarea
              name="csvText"
              rows={5}
              placeholder="firstName,lastName,phone,email,vehicleName,consentStatus&#10;Jane,Smith,6025551234,jane@example.com,2024 Toyota Camry,explicit"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono resize-none focus:ring-2 focus:ring-blue-300 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
            >
              {loading ? 'Importing…' : 'Import CSV'}
            </button>
          </form>
        </div>
      )}

      {/* Manual mode */}
      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="grid grid-cols-2 gap-3">
          {[
            { key: 'firstName',   label: 'First Name *',       required: true },
            { key: 'lastName',    label: 'Last Name *',        required: true },
            { key: 'phone',       label: 'Phone *',            required: true },
            { key: 'email',       label: 'Email',              required: false },
            { key: 'vehicleName', label: 'Vehicle of Interest', required: false },
            { key: 'leadSource',  label: 'Lead Source',        required: false },
          ].map(({ key, label, required }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-700 mb-0.5">{label}</label>
              <input
                type="text"
                required={required}
                value={manual[key as keyof typeof manual]}
                onChange={e => setManual(p => ({ ...p, [key]: e.target.value }))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
              />
            </div>
          ))}

          {/* Consent status */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-0.5">Consent Status</label>
            <select
              value={manual.consentStatus}
              onChange={e => setManual(p => ({ ...p, consentStatus: e.target.value }))}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
            >
              {CONSENT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Consent notes */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-0.5">SMS Consent Notes</label>
            <input
              type="text"
              value={manual.smsConsentNotes}
              onChange={e => setManual(p => ({ ...p, smsConsentNotes: e.target.value }))}
              placeholder="e.g. opted in via web form on 2024-01-15"
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
            />
          </div>

          <div className="col-span-2">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
            >
              {loading ? 'Importing…' : 'Import Lead'}
            </button>
          </div>
        </form>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Result summary */}
      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-emerald-800">
            ✓ {result.count} lead{result.count !== 1 ? 's' : ''} imported —
            {' '}{result.eligible} eligible, {result.warned} with warnings, {result.blocked} blocked
          </p>
          <p className="text-xs text-emerald-700">Refreshing page…</p>
        </div>
      )}
    </div>
  )
}

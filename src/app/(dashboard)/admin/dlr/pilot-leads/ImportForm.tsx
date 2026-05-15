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

const CSV_COLUMNS = [
  { name: 'firstName',         required: true,  note: '' },
  { name: 'lastName',          required: true,  note: '' },
  { name: 'phone',             required: true,  note: 'Normalized to E.164 automatically' },
  { name: 'consentStatus',     required: true,  note: 'explicit · implied · unknown · revoked' },
  { name: 'email',             required: false, note: '' },
  { name: 'vehicleName',       required: false, note: 'Used in message templates' },
  { name: 'leadSource',        required: false, note: '' },
  { name: 'originalInquiryAt', required: false, note: 'ISO date, e.g. 2024-03-15' },
  { name: 'consentSource',     required: false, note: '' },
  { name: 'consentCapturedAt', required: false, note: '' },
  { name: 'smsConsentNotes',   required: false, note: '' },
  { name: 'notes',             required: false, note: '' },
]

export function ImportForm({ tenantId }: Props) {
  const [mode, setMode]               = useState<'csv' | 'manual'>('csv')
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<ImportResponse | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [attested, setAttested]       = useState(false)
  const [showColumns, setShowColumns] = useState(false)
  const [dragging, setDragging]       = useState(false)
  const fileRef                       = useRef<HTMLInputElement>(null)

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

  // ── Drag and drop ────────────────────────────────────────────────────────────
  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.name.endsWith('.csv')) return
    const csv = await file.text()
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
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">

      {/* ── Consent attestation ─────────────────────────────────────────────── */}
      <label className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
        attested
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-amber-200 bg-amber-50'
      }`}>
        <input
          type="checkbox"
          checked={attested}
          onChange={e => setAttested(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 shrink-0"
        />
        <div>
          <p className={`text-xs font-semibold ${attested ? 'text-emerald-800' : 'text-amber-800'}`}>
            {attested ? '✓ Attestation confirmed' : 'TCPA / Consent attestation required'}
          </p>
          <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
            I confirm that all leads in this import have given consent as indicated, are covered by this
            dealer&apos;s TCR-approved SMS campaign, and that this import complies with TCPA requirements.
            Leads with <strong>unknown</strong> or <strong>revoked</strong> consent cannot be selected for the pilot batch.
          </p>
        </div>
      </label>

      {/* ── Mode tabs ───────────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {(['csv', 'manual'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              mode === m
                ? 'bg-gray-900 text-white border-gray-900'
                : 'text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {m === 'csv' ? '📄 CSV Upload' : '✏️ Manual Entry'}
          </button>
        ))}
      </div>

      {/* ── CSV mode ────────────────────────────────────────────────────────── */}
      {mode === 'csv' && (
        <div className="space-y-4">

          {/* Drop zone */}
          <div
            onClick={() => attested && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); if (attested) setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={attested ? handleDrop : e => e.preventDefault()}
            className={`border-2 border-dashed rounded-xl px-8 py-10 text-center transition-colors ${
              !attested
                ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50'
                : dragging
                ? 'border-blue-400 bg-blue-50 cursor-copy'
                : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
            }`}
          >
            {/* Upload icon */}
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-3">
              <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-700">
              {dragging ? 'Drop your CSV here' : 'Upload lead CSV'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {attested
                ? 'Click to browse, or drag and drop a .csv file'
                : 'Check the attestation above before uploading'
              }
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleCSVUpload}
            />
          </div>

          {/* Column reference (collapsible) */}
          <button
            type="button"
            onClick={() => setShowColumns(v => !v)}
            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${showColumns ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            {showColumns ? 'Hide' : 'Show'} required columns
          </button>

          {showColumns && (
            <div className="rounded-lg border border-gray-200 overflow-hidden text-xs">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 font-semibold text-gray-600 grid grid-cols-3 gap-4">
                <span>Column</span>
                <span>Required?</span>
                <span>Notes</span>
              </div>
              {CSV_COLUMNS.map(col => (
                <div key={col.name} className="px-4 py-1.5 border-b border-gray-100 last:border-0 grid grid-cols-3 gap-4 items-start">
                  <span className="font-mono text-gray-800">{col.name}</span>
                  <span className={col.required ? 'text-red-600 font-semibold' : 'text-gray-400'}>
                    {col.required ? 'Required' : 'Optional'}
                  </span>
                  <span className="text-gray-500">{col.note}</span>
                </div>
              ))}
              <div className="bg-amber-50 border-t border-amber-100 px-4 py-2 text-amber-700">
                <strong>consentStatus rules:</strong> Only <code>explicit</code> and <code>implied</code> leads can be selected for the pilot.
                <code className="ml-1">unknown</code> is imported but blocked from selection.
                <code className="ml-1">revoked</code> leads are hard-blocked and cannot be imported.
              </div>
            </div>
          )}

          {/* Paste area */}
          <div className="relative">
            <div className="absolute inset-x-0 top-0 flex items-center">
              <div className="border-t border-gray-200 flex-1" />
              <span className="mx-3 text-xs text-gray-400 bg-white px-1">or paste CSV</span>
              <div className="border-t border-gray-200 flex-1" />
            </div>
          </div>
          <form onSubmit={handleCSVPaste} className="space-y-2 pt-3">
            <textarea
              name="csvText"
              rows={4}
              disabled={!attested}
              placeholder={
                attested
                  ? 'firstName,lastName,phone,email,vehicleName,consentStatus\nJane,Smith,6025551234,jane@example.com,2024 Toyota Camry,explicit'
                  : 'Check the attestation above to enable paste import'
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono resize-none focus:ring-2 focus:ring-blue-300 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={loading || !attested}
              className="px-4 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Importing…' : 'Import pasted CSV'}
            </button>
          </form>
        </div>
      )}

      {/* ── Manual mode ─────────────────────────────────────────────────────── */}
      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'firstName',   label: 'First Name',        required: true },
              { key: 'lastName',    label: 'Last Name',         required: true },
              { key: 'phone',       label: 'Phone',             required: true },
              { key: 'email',       label: 'Email',             required: false },
              { key: 'vehicleName', label: 'Vehicle of Interest', required: false },
              { key: 'leadSource',  label: 'Lead Source',       required: false },
            ].map(({ key, label, required }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {label} {required && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  required={required}
                  disabled={!attested}
                  value={manual[key as keyof typeof manual]}
                  onChange={e => setManual(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
                />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-0.5">Consent Status</label>
            <select
              value={manual.consentStatus}
              disabled={!attested}
              onChange={e => setManual(p => ({ ...p, consentStatus: e.target.value }))}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
            >
              {CONSENT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-0.5">SMS Consent Notes</label>
            <input
              type="text"
              value={manual.smsConsentNotes}
              disabled={!attested}
              onChange={e => setManual(p => ({ ...p, smsConsentNotes: e.target.value }))}
              placeholder="e.g. opted in via web form on 2024-01-15"
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !attested}
            className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Importing…' : 'Import Lead'}
          </button>
        </form>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Result summary ──────────────────────────────────────────────────── */}
      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-emerald-800">
            ✓ {result.count} lead{result.count !== 1 ? 's' : ''} imported —{' '}
            {result.eligible} eligible, {result.warned} with warnings, {result.blocked} blocked
          </p>
          <p className="text-xs text-emerald-700">Refreshing page…</p>
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * Dealer-only dark-themed import form.
 * Same logic as the shared admin ImportForm; dealer-appropriate styling only.
 * API default is the dealer route surface (/api/dealer/pilot-leads).
 */

import { useState, useRef } from 'react'
import { LEAD_UPLOAD_CERT_TEXT } from '@/lib/compliance/attestation-text'

type Props = {
  tenantId: string
  apiBase?: string
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
  { value: 'explicit', label: 'Explicit — customer opted in directly' },
  { value: 'implied',  label: 'Implied — inferred from inquiry context' },
  { value: 'unknown',  label: 'Unknown — not captured' },
  { value: 'revoked',  label: 'Revoked — customer asked to stop' },
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

export function DealerImportForm({ tenantId, apiBase = '/api/dealer/pilot-leads' }: Props) {
  const [mode, setMode]               = useState<'csv' | 'manual'>('csv')
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<ImportResponse | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [attested, setAttested]       = useState(false)
  const [showColumns, setShowColumns] = useState(false)
  const [dragging, setDragging]       = useState(false)
  const fileRef                       = useRef<HTMLInputElement>(null)

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

  async function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const csv = await file.text()
    await submitImport({ csv, fileName: file.name })
  }

  async function handleCSVPaste(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const csv  = (form.elements.namedItem('csvText') as HTMLTextAreaElement).value
    if (!csv.trim()) return
    await submitImport({ csv, fileName: 'pasted-csv' })
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.name.endsWith('.csv')) return
    const csv = await file.text()
    await submitImport({ csv, fileName: file.name })
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submitImport({ rows: [{ ...manual, vehicleName: manual.vehicleName || null }] })
  }

  async function submitImport(payload: Record<string, unknown>) {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`${apiBase}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, attested, ...payload }),
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

  const inputStyle = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.85)',
  }
  const inputClass = 'w-full px-2.5 py-1.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="space-y-5">

      {/* ── SMS Consent Certification ──────────────────────────────────────── */}
      <label
        className="flex items-start gap-3 px-4 py-3.5 rounded-xl cursor-pointer transition-colors"
        style={attested ? {
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.4)',
        } : {
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.38)',
        }}
      >
        <input
          type="checkbox"
          checked={attested}
          onChange={e => setAttested(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded accent-emerald-500"
        />
        <div>
          <p className="text-xs font-semibold" style={{ color: attested ? '#86efac' : '#fde68a' }}>
            {attested ? '✓ Attestation confirmed' : 'SMS Consent Certification required'}
          </p>
          {/* Must match LEAD_UPLOAD_CERT_TEXT verbatim — snapshotted into compliance_attestations */}
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>
            {LEAD_UPLOAD_CERT_TEXT}
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Leads with <strong style={{ color: 'rgba(255,255,255,0.7)' }}>unknown</strong> or{' '}
            <strong style={{ color: 'rgba(255,255,255,0.7)' }}>revoked</strong> consent cannot be selected for the campaign.
          </p>
        </div>
      </label>

      {/* ── Mode tabs ───────────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {(['csv', 'manual'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors"
            style={mode === m ? {
              background: 'linear-gradient(180deg, #ff2929, #8b0909)',
              color: '#fff',
              border: '1px solid rgba(255,80,80,0.7)',
              boxShadow: '0 0 10px rgba(255,27,27,0.4)',
            } : {
              background: 'rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.65)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
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
            className="border-2 border-dashed rounded-xl px-8 py-10 text-center transition-colors"
            style={!attested ? {
              borderColor: 'rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.02)',
              cursor: 'not-allowed',
              opacity: 0.45,
            } : dragging ? {
              borderColor: 'rgba(255,27,27,0.7)',
              background: 'rgba(255,27,27,0.1)',
              cursor: 'copy',
            } : {
              borderColor: 'rgba(255,255,255,0.16)',
              background: 'rgba(255,255,255,0.03)',
              cursor: 'pointer',
            }}
          >
            <div
              className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
              style={{
                background: dragging ? 'rgba(255,27,27,0.2)' : 'rgba(255,27,27,0.12)',
                border: '1px solid rgba(255,27,27,0.35)',
              }}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: '#ff5252' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-white">
              {dragging ? 'Drop your CSV here' : 'Upload lead CSV'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {attested
                ? 'Click to browse, or drag and drop a .csv file'
                : 'Check the attestation above before uploading'}
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
            className="flex items-center gap-1.5 text-xs font-medium"
            style={{ color: '#ff5252' }}
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showColumns ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            {showColumns ? 'Hide' : 'Show'} required columns
          </button>

          {showColumns && (
            <div
              className="rounded-lg overflow-hidden text-xs"
              style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.35)' }}
            >
              <div
                className="px-4 py-2 border-b grid grid-cols-3 gap-4 font-semibold"
                style={{ borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }}
              >
                <span>Column</span><span>Required?</span><span>Notes</span>
              </div>
              {CSV_COLUMNS.map(col => (
                <div
                  key={col.name}
                  className="px-4 py-1.5 border-b last:border-0 grid grid-cols-3 gap-4 items-start"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  <span className="font-mono" style={{ color: 'rgba(255,255,255,0.85)' }}>{col.name}</span>
                  <span style={{ color: col.required ? '#ff5252' : 'rgba(255,255,255,0.35)', fontWeight: col.required ? 600 : 400 }}>
                    {col.required ? 'Required' : 'Optional'}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.5)' }}>{col.note}</span>
                </div>
              ))}
              <div
                className="border-t px-4 py-2"
                style={{
                  borderColor: 'rgba(245,158,11,0.3)',
                  background: 'rgba(245,158,11,0.08)',
                  color: '#fde68a',
                }}
              >
                <strong>consentStatus rules:</strong> Only <code>explicit</code> and <code>implied</code> leads
                can be selected for the pilot. <code className="ml-1">unknown</code> is imported but blocked
                from selection. <code className="ml-1">revoked</code> leads are hard-blocked and cannot be imported.
              </div>
            </div>
          )}

          {/* Paste area divider */}
          <div className="relative pt-0.5">
            <div className="absolute inset-x-0 top-0 flex items-center">
              <div className="flex-1" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }} />
              <span className="mx-3 text-xs px-1" style={{ color: 'rgba(255,255,255,0.35)', background: '#0c0c0e' }}>
                or paste CSV
              </span>
              <div className="flex-1" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }} />
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
              className={`${inputClass} font-mono resize-none`}
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={loading || !attested}
              className="px-4 py-1.5 text-white text-xs font-semibold rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                border: '1px solid rgba(255,80,80,0.7)',
                boxShadow: '0 0 10px rgba(255,27,27,0.4)',
              }}
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
              { key: 'firstName',   label: 'First Name',          required: true },
              { key: 'lastName',    label: 'Last Name',           required: true },
              { key: 'phone',       label: 'Phone',               required: true },
              { key: 'email',       label: 'Email',               required: false },
              { key: 'vehicleName', label: 'Vehicle of Interest', required: false },
              { key: 'leadSource',  label: 'Lead Source',         required: false },
            ].map(({ key, label, required }) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {label} {required && <span style={{ color: '#ff5252' }}>*</span>}
                </label>
                <input
                  type="text"
                  required={required}
                  disabled={!attested}
                  value={manual[key as keyof typeof manual]}
                  onChange={e => setManual(p => ({ ...p, [key]: e.target.value }))}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium mb-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Consent Status
            </label>
            <select
              value={manual.consentStatus}
              disabled={!attested}
              onChange={e => setManual(p => ({ ...p, consentStatus: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            >
              {CONSENT_OPTIONS.map(o => (
                <option key={o.value} value={o.value} style={{ background: '#1a1a1c' }}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              SMS Consent Notes
            </label>
            <input
              type="text"
              value={manual.smsConsentNotes}
              disabled={!attested}
              onChange={e => setManual(p => ({ ...p, smsConsentNotes: e.target.value }))}
              placeholder="e.g. opted in via web form on 2024-01-15"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !attested}
            className="px-4 py-2 text-white text-sm font-semibold rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: 'linear-gradient(180deg, #ff2929, #8b0909)',
              border: '1px solid rgba(255,80,80,0.7)',
              boxShadow: '0 0 10px rgba(255,27,27,0.4)',
            }}
          >
            {loading ? 'Importing…' : 'Import Lead'}
          </button>
        </form>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{
            background: 'rgba(255,27,27,0.12)',
            border: '1px solid rgba(255,27,27,0.45)',
            color: '#fca5a5',
          }}
        >
          {error}
        </div>
      )}

      {/* ── Result summary ──────────────────────────────────────────────────── */}
      {result && (
        <div
          className="rounded-lg px-4 py-3 space-y-1"
          style={{
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.4)',
          }}
        >
          <p className="text-sm font-semibold" style={{ color: '#86efac' }}>
            ✓ {result.count} lead{result.count !== 1 ? 's' : ''} imported —{' '}
            {result.eligible} eligible, {result.warned} with warnings, {result.blocked} blocked
          </p>
          <p className="text-xs" style={{ color: 'rgba(134,239,172,0.7)' }}>Refreshing page…</p>
        </div>
      )}
    </div>
  )
}

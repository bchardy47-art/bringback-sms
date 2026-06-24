'use client'

import { useState, useTransition } from 'react'
import { importProspectsAction } from '../actions'

type Summary = {
  created: number; updated: number; skippedDuplicates: number
  missingRequired: number; invalidEmails: number; totalRows: number
  rowErrors: Array<{ row: number; message: string }>
}

const SAMPLE = `Dealership name,City/state,Website,Main phone,Public email,Contact form URL,Best contact person,Contact title,Source URL,Notes on dealership fit,Outreach priority,Suggested personalization line
Revival Ridge Motors,"Boise, ID",https://revivalridge.com,208-555-0100,sales@revivalridge.com,,Jordan Lee,GM,https://revivalridge.com/about,Independent used lot with aged CRM,A,Saw your 4.6-star reviews on the pre-owned lineup`

export function ImportForm() {
  const [pending, start] = useTransition()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')

  function submit() {
    setError(null); setSummary(null)
    const fd = new FormData()
    fd.set('csv', text)
    start(async () => {
      const res = await importProspectsAction(null, fd)
      if (!res.ok) { setError(res.error ?? 'Import failed'); return }
      setSummary(res.summary as Summary)
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <p className="text-xs text-gray-500">
          Paste rows from your research spreadsheet (CSV or TSV, with a header row). Columns are matched flexibly:
          dealership name, city/state, website, main phone, public email, contact form URL, best contact person,
          contact title, source URL, fit notes, priority (A/B/C or High/Med/Low), personalization line.
        </p>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={12}
          placeholder={SAMPLE}
          className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-100"
        />
        <div className="flex items-center gap-2">
          <button onClick={submit} disabled={pending || !text.trim()} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40">
            {pending ? 'Importing…' : 'Import prospects'}
          </button>
          <button onClick={() => setText(SAMPLE)} className="px-3 py-2 text-xs text-gray-500 hover:underline">Load sample</button>
        </div>
        <p className="text-xs text-gray-400">
          Dedup is automatic on website / email / (dealership + city). Emails are lowercased and validated. A prospect
          needs a public email <strong>and</strong> a source URL to become &ldquo;Ready to contact&rdquo;. No emails are guessed; contact
          forms are never auto-submitted.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {summary && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Import result</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Created" value={summary.created} tone="good" />
            <Stat label="Updated" value={summary.updated} />
            <Stat label="Duplicates" value={summary.skippedDuplicates} />
            <Stat label="Missing required" value={summary.missingRequired} tone={summary.missingRequired ? 'warn' : undefined} />
            <Stat label="Invalid emails" value={summary.invalidEmails} tone={summary.invalidEmails ? 'warn' : undefined} />
            <Stat label="Total rows" value={summary.totalRows} />
          </div>
          {summary.rowErrors.length > 0 && (
            <ul className="mt-3 text-xs text-orange-600 space-y-0.5">
              {summary.rowErrors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
            </ul>
          )}
          <a href="/admin/outreach" className="inline-block mt-4 text-xs font-semibold text-red-600 hover:underline">View prospects →</a>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-orange-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export function CsvImportButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const router = useRouter()

  async function handleFile(file: File) {
    setUploading(true)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/leads/import', { method: 'POST', body: formData })
    const data: ImportResult = await res.json()

    setResult(data)
    setUploading(false)
    router.refresh()
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <p className="text-xs text-gray-600">
          Imported <strong className="text-green-600">{result.imported}</strong>
          {result.skipped > 0 && (
            <>, skipped <strong className="text-red-500">{result.skipped}</strong></>
          )}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />

      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="px-3 py-1.5 rounded-md bg-white border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {uploading ? 'Importing…' : 'Import CSV'}
      </button>
    </div>
  )
}

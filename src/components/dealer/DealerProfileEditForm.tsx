'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Slim profile form for the dealer shell. Dealers don't receive SMS
// handoff alerts, so there is no alert-phone field here; tenant id is
// also not exposed. For the admin/team profile (name + alert phone +
// tenant id), see ProfileEditForm under components/settings.
//
// The name field is intentionally uncontrolled (defaultValue + ref).
// Verified live: SSR already paints the correct value="<displayName>"
// into the rendered HTML; a controlled input with a useState mirror was
// observed to end up blank in practice because any post-mount setState
// (effect, fetch, autofill interaction) would re-render and could erase
// the SSR-painted value. Uncontrolled keeps the SSR value in the DOM
// and lets the user freely edit; we read the current value via ref at
// submit time.
export function DealerProfileEditForm({
  initialName,
  email,
}: {
  initialName: string
  email: string
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const next = nameRef.current?.value.trim() ?? ''
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        const msg =
          data?.error?.formErrors?.[0] ??
          data?.error?.fieldErrors?.name?.[0] ??
          'Could not save changes.'
        setError(msg)
        return
      }
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
      <div>
        <label htmlFor="dealerName" className="block text-sm font-medium text-gray-700">
          Name
        </label>
        <input
          ref={nameRef}
          id="dealerName"
          name="name"
          type="text"
          defaultValue={initialName}
          autoComplete="name"
          className="mt-1 block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          placeholder="Your name"
        />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700">Email</p>
        <p className="mt-1 text-sm text-gray-500 select-all">{email}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && <span className="text-xs text-emerald-600 font-medium">✓ Saved</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  )
}

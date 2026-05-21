'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// Slim profile form for the dealer shell. Dealers don't receive SMS
// handoff alerts, so there is no alert-phone field here; tenant id is
// also not exposed. For the admin/team profile (name + alert phone +
// tenant id), see ProfileEditForm under components/settings.
export function DealerProfileEditForm({
  initialName,
  email,
}: {
  initialName: string
  email: string
}) {
  const [name, setName] = useState(initialName)
  // useState(initialName) captures only the first render. If the parent
  // re-renders with a refreshed initialName (e.g., after router.refresh()
  // following a save, or when the server-rendered prop arrives later than
  // the initial hydration), sync the local state so the input never sticks
  // on a stale empty value.
  useEffect(() => {
    setName(initialName)
  }, [initialName])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || undefined }),
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
          id="dealerName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
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

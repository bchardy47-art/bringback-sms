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
    <form onSubmit={handleSave} className="space-y-4">
      <div>
        <label
          htmlFor="dealerName"
          style={{ display: 'block', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--tx-mid)', marginBottom: 5 }}
        >
          Name
        </label>
        <input
          ref={nameRef}
          id="dealerName"
          name="name"
          type="text"
          defaultValue={initialName}
          autoComplete="name"
          className="dlr-input"
          placeholder="Your name"
        />
      </div>
      <div>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--tx-mid)', marginBottom: 5 }}>
          Email
        </p>
        <p style={{ fontSize: 14, color: 'var(--tx-hi)', userSelect: 'all' }}>{email}</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4 }}>
        <button type="submit" disabled={saving} className="dlr-form-save">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved  && <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>✓ Saved</span>}
        {error  && <span style={{ fontSize: 12, color: '#ff8a7a' }}>{error}</span>}
      </div>
    </form>
  )
}

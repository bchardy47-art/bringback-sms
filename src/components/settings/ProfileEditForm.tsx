'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ProfileEditForm({
  initialName,
  email,
  role,
  tenantId,
  initialPhone,
}: {
  initialName: string
  email: string
  role: string
  tenantId: string
  initialPhone: string | null
}) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone ?? '')
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
        body: JSON.stringify({
          name: name.trim() || undefined,
          phone: phone.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        const msg = data?.error?.formErrors?.[0]
          ?? data?.error?.fieldErrors?.phone?.[0]
          ?? data?.error?.fieldErrors?.name?.[0]
          ?? 'Save failed'
        setError(msg)
        return
      }

      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave}>
      <dl>
        {/* Name */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-50">
          <dt className="text-xs text-gray-500 w-24 shrink-0">Name</dt>
          <dd className="flex-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm font-medium text-gray-800 bg-transparent border-0 border-b border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none transition-colors py-0.5"
              placeholder="Your name"
            />
          </dd>
        </div>

        {/* Email — read-only */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-50">
          <dt className="text-xs text-gray-500 w-24 shrink-0">Email</dt>
          <dd className="text-sm font-medium text-gray-400 select-all">{email}</dd>
        </div>

        {/* Role — read-only */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-50">
          <dt className="text-xs text-gray-500 w-24 shrink-0">Role</dt>
          <dd className="text-sm font-medium text-gray-800 capitalize">{role}</dd>
        </div>

        {/* Tenant ID — read-only */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-50">
          <dt className="text-xs text-gray-500 w-24 shrink-0">Tenant ID</dt>
          <dd className="text-xs font-mono text-gray-800 select-all">{tenantId}</dd>
        </div>

        {/* Phone — editable, used for SMS alerts */}
        <div className="flex items-center justify-between px-6 py-3.5">
          <dt className="text-xs text-gray-500 w-24 shrink-0">
            Alert phone
            <span className="block text-gray-400 font-normal mt-0.5">For SMS handoff alerts</span>
          </dt>
          <dd className="flex-1">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full text-sm font-medium text-gray-800 bg-transparent border-0 border-b border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none transition-colors py-0.5"
              placeholder="+18015551234"
            />
          </dd>
        </div>
      </dl>

      {/* Actions */}
      <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
        <button
          type="submit"
          disabled={saving}
          className="text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && (
          <span className="text-xs text-green-600 font-medium">✓ Saved</span>
        )}
        {error && (
          <span className="text-xs text-red-500">{error}</span>
        )}
        <p className="ml-auto text-xs text-gray-400">
          Add your mobile number to receive SMS alerts when leads reply or need handoff.
        </p>
      </div>
    </form>
  )
}

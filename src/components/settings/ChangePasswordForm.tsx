'use client'

import { useState } from 'react'

type FieldErrors = Partial<Record<'currentPassword' | 'newPassword' | 'confirmPassword', string>>

const MIN_LEN = 10

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  function clearForm() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  function clientValidate(): FieldErrors {
    const e: FieldErrors = {}
    if (!currentPassword) e.currentPassword = 'Current password is required'
    if (!newPassword) e.newPassword = 'New password is required'
    else if (newPassword.length < MIN_LEN)
      e.newPassword = `New password must be at least ${MIN_LEN} characters`
    else if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword))
      e.newPassword = 'New password must include at least one letter and one number'
    else if (newPassword === currentPassword)
      e.newPassword = 'New password must be different from the current password'
    if (!confirmPassword) e.confirmPassword = 'Please confirm the new password'
    else if (newPassword && confirmPassword !== newPassword)
      e.confirmPassword = 'New password and confirmation do not match'
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaved(false)
    setFormError(null)

    const localErrors = clientValidate()
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors)
      return
    }
    setErrors({})
    setSaving(true)

    try {
      const res = await fetch('/api/users/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      })

      if (res.ok) {
        clearForm()
        setSaved(true)
        return
      }

      if (res.status === 422) {
        const data = await res.json().catch(() => null)
        const fieldErrors = data?.error?.fieldErrors as
          | Partial<Record<string, string[]>>
          | undefined
        const next: FieldErrors = {}
        if (fieldErrors?.currentPassword?.[0]) next.currentPassword = fieldErrors.currentPassword[0]
        if (fieldErrors?.newPassword?.[0]) next.newPassword = fieldErrors.newPassword[0]
        if (fieldErrors?.confirmPassword?.[0]) next.confirmPassword = fieldErrors.confirmPassword[0]
        if (Object.keys(next).length > 0) {
          setErrors(next)
        } else {
          setFormError('Could not update password. Please check the fields and try again.')
        }
        return
      }

      if (res.status === 401) {
        setFormError('Your session expired. Please sign in again.')
        return
      }

      setFormError('Something went wrong. Please try again.')
    } catch {
      setFormError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4" noValidate>
      <PasswordField
        id="currentPassword"
        label="Current password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={setCurrentPassword}
        error={errors.currentPassword}
        disabled={saving}
      />
      <PasswordField
        id="newPassword"
        label="New password"
        autoComplete="new-password"
        value={newPassword}
        onChange={setNewPassword}
        error={errors.newPassword}
        disabled={saving}
        hint={`At least ${MIN_LEN} characters, with a letter and a number`}
      />
      <PasswordField
        id="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        error={errors.confirmPassword}
        disabled={saving}
      />

      {formError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {formError}
        </div>
      )}
      {saved && (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          Password updated. Use your new password the next time you sign in.
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {saving ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </form>
  )
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
  error,
  disabled,
  hint,
}: {
  id: string
  label: string
  autoComplete: 'current-password' | 'new-password'
  value: string
  onChange: (v: string) => void
  error?: string
  disabled?: boolean
  hint?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="password"
        autoComplete={autoComplete}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`mt-1 block w-full max-w-sm rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
            : 'border-gray-300 focus:border-gray-500 focus:ring-gray-500'
        }`}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

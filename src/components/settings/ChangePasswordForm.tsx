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
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
          style={{
            borderRadius: 8, padding: '9px 12px', fontSize: 13,
            border: '1px solid rgba(255,80,80,0.3)',
            background: 'rgba(255,42,42,0.08)',
            color: '#ff8a7a',
          }}
        >
          {formError}
        </div>
      )}
      {saved && (
        <div
          role="status"
          style={{
            borderRadius: 8, padding: '9px 12px', fontSize: 13,
            border: '1px solid rgba(34,197,94,0.3)',
            background: 'rgba(34,197,94,0.07)',
            color: '#4ade80',
          }}
        >
          Password updated. Use your new password the next time you sign in.
        </div>
      )}

      <div style={{ paddingTop: 4 }}>
        <button type="submit" disabled={saving} className="dlr-form-save">
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
      <label
        htmlFor={id}
        style={{ display: 'block', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--tx-mid)', marginBottom: 5 }}
      >
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
        className={`dlr-input${error ? ' dlr-input-error' : ''}`}
      />
      {error ? (
        <p id={`${id}-error`} style={{ marginTop: 4, fontSize: 12, color: '#ff8a7a' }}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} style={{ marginTop: 4, fontSize: 12, color: 'var(--tx-lo)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

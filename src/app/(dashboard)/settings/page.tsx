import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { Settings, User, Bell, Shield, Phone } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { ProfileEditForm } from '@/components/settings/ProfileEditForm'

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  // Load fresh user record to get current phone (session may be stale)
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { name: true, email: true, phone: true, role: true },
  })

  const isNotifiable = user?.role === 'manager' || user?.role === 'admin'
  const missingPhone = isNotifiable && !user?.phone

  return (
    <div className="min-h-full bg-gray-50">
      {/* Alert phone warning banner */}
      {missingPhone && (
        <div className="bg-amber-50 border-b border-amber-200 px-8 py-3 flex items-center gap-3">
          <span className="text-amber-600 text-lg">⚠️</span>
          <p className="text-sm text-amber-800">
            <span className="font-semibold">No alert phone set.</span>{' '}
            You won't receive SMS notifications when leads reply or need handoff.
            Add your mobile number below under <span className="font-medium">Account → Alert phone</span>.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your account and platform preferences</p>
      </div>

      <div className="px-8 py-6 max-w-3xl space-y-5">
        {/* Account — editable */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
              <User size={18} className="text-blue-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Account</h2>
              <p className="text-xs text-gray-400">Your profile and notification details</p>
            </div>
          </div>
          <ProfileEditForm
            initialName={user?.name ?? session.user.name ?? ''}
            email={user?.email ?? session.user.email ?? ''}
            role={user?.role ?? session.user.role ?? 'agent'}
            tenantId={session.user.tenantId}
            initialPhone={user?.phone ?? null}
          />
        </div>

        {/* Messaging */}
        <SettingsSection
          icon={<Phone size={18} className="text-emerald-500" />}
          title="Messaging"
          description="SMS provider configuration"
          items={[
            { label: 'Provider', value: 'Telnyx' },
            { label: 'Webhook', value: '/api/webhooks/telnyx', mono: true },
            { label: 'Signature Verification', value: process.env.NODE_ENV === 'production' ? 'Enabled' : 'Disabled (dev)' },
          ]}
        />

        {/* Notifications — now active! */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
              <Bell size={18} className="text-orange-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Notifications</h2>
              <p className="text-xs text-gray-400">SMS and email alerts for managers and admins</p>
            </div>
          </div>
          <dl>
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-50">
              <dt className="text-xs text-gray-500">Revival alerts</dt>
              <dd className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                <span className="text-sm font-medium text-gray-800">Active</span>
              </dd>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-50">
              <dt className="text-xs text-gray-500">Handoff alerts</dt>
              <dd className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                <span className="text-sm font-medium text-gray-800">Active</span>
              </dd>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <dt className="text-xs text-gray-500">Delivery channel</dt>
              <dd className="text-sm font-medium text-gray-800">SMS (+ email if configured)</dd>
            </div>
          </dl>
          <div className="px-6 py-3 bg-orange-50 border-t border-orange-100">
            <p className="text-xs text-orange-700">
              Managers and admins with an <span className="font-semibold">Alert phone</span> set above will receive SMS notifications when a lead replies or needs human handoff.
            </p>
          </div>
        </div>

        {/* Security */}
        <SettingsSection
          icon={<Shield size={18} className="text-violet-500" />}
          title="Security"
          description="Coming soon — two-factor auth and API keys"
          items={[]}
          comingSoon
        />
      </div>
    </div>
  )
}

function SettingsSection({
  icon,
  title,
  description,
  items,
  comingSoon,
}: {
  icon: React.ReactNode
  title: string
  description: string
  items: { label: string; value: string; mono?: boolean }[]
  comingSoon?: boolean
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400">{description}</p>
        </div>
        {comingSoon && (
          <span className="ml-auto text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
            Coming soon
          </span>
        )}
      </div>
      {items.length > 0 && (
        <dl>
          {items.map((item, i) => (
            <div
              key={item.label}
              className="flex items-center justify-between px-6 py-3.5"
              style={{ borderBottom: i < items.length - 1 ? '1px solid #f9fafb' : undefined }}
            >
              <dt className="text-xs text-gray-500">{item.label}</dt>
              <dd className={`text-sm font-medium text-gray-800 ${item.mono ? 'font-mono text-xs' : ''}`}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

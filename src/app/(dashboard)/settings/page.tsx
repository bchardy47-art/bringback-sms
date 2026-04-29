import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { Settings, User, Bell, Shield, Phone } from 'lucide-react'

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your account and platform preferences</p>
      </div>

      <div className="px-8 py-6 max-w-3xl space-y-5">
        {/* Account */}
        <SettingsSection
          icon={<User size={18} className="text-blue-500" />}
          title="Account"
          description="Your profile and login details"
          items={[
            { label: 'Name', value: session.user.name ?? '—' },
            { label: 'Email', value: session.user.email ?? '—' },
            { label: 'Role', value: session.user.role ?? 'Agent' },
            { label: 'Tenant ID', value: session.user.tenantId, mono: true },
          ]}
        />

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

        {/* Notifications */}
        <SettingsSection
          icon={<Bell size={18} className="text-orange-500" />}
          title="Notifications"
          description="Coming soon — configure alert preferences"
          items={[]}
          comingSoon
        />

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

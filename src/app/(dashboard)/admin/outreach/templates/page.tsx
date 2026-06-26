import { redirect } from 'next/navigation'
import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { outreachTemplates } from '@/lib/db/schema'
import { getAdminUser } from '@/lib/admin/access'
import { ensureDefaultTemplates } from '@/lib/outreach/templates'

export const dynamic = 'force-dynamic'

export default async function TemplatesPage() {
  const user = await getAdminUser()
  if (!user) redirect('/login?callbackUrl=/admin/outreach/templates')

  await ensureDefaultTemplates()
  const templates = await db.select().from(outreachTemplates).orderBy(desc(outreachTemplates.isActive), outreachTemplates.name)

  return (
    <div className="px-4 md:px-8 py-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Outreach templates</h1>
        <p className="text-sm text-gray-500 mt-1">
          Merge fields: <code>{'{{dealershipName}}'}</code>, <code>{'{{contactFirstNameOrTeam}}'}</code>, <code>{'{{personalizationLine}}'}</code>,
          {' '}<code>{'{{ctaUrl}}'}</code>, <code>{'{{businessContactFooter}}'}</code>. Templates marked <span className="font-semibold text-emerald-700">Active</span> are wired to sending.
        </p>
      </div>

      <div className="space-y-4">
        {templates.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-semibold text-gray-900">{t.name}</h2>
              <span className="text-xs font-mono text-gray-400">{t.key}</span>
              {t.isActive
                ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Active</span>
                : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">Preview only</span>}
            </div>
            {t.description && <p className="text-xs text-gray-500 mb-2">{t.description}</p>}
            <p className="text-xs text-gray-600 mb-1"><span className="font-semibold">Subject:</span> {t.subject}</p>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100">{t.bodyText}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

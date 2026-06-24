import { redirect } from 'next/navigation'
import { getAdminUser } from '@/lib/admin/access'
import { ImportForm } from './ImportForm'

export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const user = await getAdminUser()
  if (!user) redirect('/login?callbackUrl=/admin/outreach/import')

  return (
    <div className="px-4 md:px-8 py-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import prospects</h1>
        <p className="text-sm text-gray-500 mt-1">Bring researched dealerships into the outreach CRM. Review-first — nothing is contacted on import.</p>
      </div>
      <ImportForm />
    </div>
  )
}

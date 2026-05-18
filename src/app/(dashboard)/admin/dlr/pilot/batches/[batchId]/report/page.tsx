/**
 * Admin-facing Campaign Report page.
 *
 * Access control: admin-only. Reads any tenant's batch (cross-tenant). Reuses
 * the same CampaignReportView from the dealer route — the only differences
 * are: (a) we pass tenantId = null to the aggregator, (b) showTenant = true,
 * (c) export and back-links point at the admin variants.
 */

import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getCampaignReport } from '@/lib/pilot/campaign-report'
import CampaignReportView from '@/app/(dealer)/dealer/campaigns/[batchId]/report/CampaignReportView'

type RouteContext = { params: { batchId: string } }

export default async function AdminCampaignReportPage({ params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect('/login')
  if (session.user.role !== 'admin') redirect('/login')

  const result = await getCampaignReport({
    batchId: params.batchId,
    tenantId: null,
  })
  if (!result.ok) notFound()

  return (
    <CampaignReportView
      report={result.report}
      exportHref={`/api/admin/dlr/pilot/batches/${params.batchId}/report/export`}
      backHref={`/admin/dlr/pilot/${params.batchId}`}
      backLabel="Back to batch"
      showTenant={true}
    />
  )
}

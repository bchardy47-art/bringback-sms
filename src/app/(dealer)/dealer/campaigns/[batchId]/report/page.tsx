/**
 * Dealer-facing Campaign Report page.
 *
 * Access control: dealer-only, scoped to session.user.tenantId. Admins are
 * redirected to the admin variant of this page so they keep using the
 * cross-tenant tools they're used to.
 */

import { redirect, notFound } from 'next/navigation'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import { getCampaignReport } from '@/lib/pilot/campaign-report'
import CampaignReportView from './CampaignReportView'

type RouteContext = { params: { batchId: string } }

export default async function DealerCampaignReportPage({ params }: RouteContext) {
  const session = await getDealerSession()
  if (!session?.user?.tenantId) redirect('/login')
  if (session.user.role !== 'dealer') {
    redirect(`/admin/dlr/pilot/batches/${params.batchId}/report`)
  }

  const result = await getCampaignReport({
    batchId: params.batchId,
    tenantId: session.user.tenantId,
  })
  if (!result.ok) notFound()

  return (
    <CampaignReportView
      report={result.report}
      exportHref={`/api/dealer/campaigns/${params.batchId}/report/export`}
      backHref={`/dealer/batches/${params.batchId}`}
      backLabel="Back to batch"
      showTenant={false}
    />
  )
}

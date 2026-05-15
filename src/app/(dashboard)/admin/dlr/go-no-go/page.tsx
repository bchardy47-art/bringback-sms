/**
 * Phase 12 — Go / No-Go Report
 * /admin/dlr/go-no-go
 *
 * Authoritative pre-flight go/no-go decision for the first live SMS pilot.
 * Aggregates the Telnyx config audit + pre-live checklist into a single
 * verdict per tenant.
 *
 * All blockers from both sources are surfaced here. System will not send
 * live messages if any blocker exists.
 */

import { generateGoNoGoReportAll, type GoNoGoReport, type GoNoGoVerdict } from '@/lib/pilot/go-no-go'

// ── Status helpers ─────────────────────────────────────────────────────────────

const VERDICT_ICON: Record<GoNoGoVerdict, string> = {
  go:     '✅',
  no_go:  '🚫',
}

// ── Components ─────────────────────────────────────────────────────────────────

function VerdictCard({ report }: { report: GoNoGoReport }) {
  const isGo = report.verdict === 'go'

  return (
    <div className={`rounded-xl border-2 p-6 ${
      isGo
        ? 'border-emerald-300 bg-emerald-50'
        : 'border-red-300 bg-red-50'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{VERDICT_ICON[report.verdict]}</span>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{report.tenantName}</h2>
              <p className={`text-sm font-semibold mt-0.5 ${isGo ? 'text-emerald-700' : 'text-red-700'}`}>
                {isGo ? 'CLEARED FOR FIRST LIVE PILOT' : 'NOT CLEARED — BLOCKERS MUST BE RESOLVED'}
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">{report.summary}</p>
        </div>

        <div className="flex flex-col gap-1 items-end flex-shrink-0">
          {report.blockerCount > 0 && (
            <span className="px-2.5 py-1 rounded-lg text-sm font-bold bg-red-100 text-red-700">
              {report.blockerCount} blocker{report.blockerCount !== 1 ? 's' : ''}
            </span>
          )}
          {report.warningCount > 0 && (
            <span className="px-2.5 py-1 rounded-lg text-sm font-medium bg-amber-100 text-amber-700">
              {report.warningCount} warning{report.warningCount !== 1 ? 's' : ''}
            </span>
          )}
          {isGo && report.warningCount === 0 && (
            <span className="px-2.5 py-1 rounded-lg text-sm font-bold bg-emerald-100 text-emerald-700">
              All clear
            </span>
          )}
        </div>
      </div>

      {/* Blockers */}
      {report.blockers.length > 0 && (
        <div className="mt-5 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-red-700">Blockers</p>
          <div className="space-y-2">
            {report.blockers.map(b => (
              <div
                key={`${b.source}-${b.checkId}`}
                className="border border-red-200 bg-white rounded-lg px-4 py-3 flex items-start gap-3"
              >
                <span className="text-red-500 font-bold text-sm flex-shrink-0 mt-0.5">✗</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-gray-800">{b.checkLabel}</p>
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      {b.sectionTitle}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{b.detail}</p>
                  {b.hint && (
                    <p className="text-xs text-blue-600 mt-1 italic">💡 {b.hint}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Warnings</p>
          <div className="space-y-1.5">
            {report.warnings.map(w => (
              <div
                key={`${w.source}-${w.checkId}`}
                className="border border-amber-200 bg-white rounded-lg px-4 py-2.5 flex items-start gap-3"
              >
                <span className="text-amber-500 font-bold text-sm flex-shrink-0 mt-0.5">⚠</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-gray-800">{w.checkLabel}</p>
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      {w.sectionTitle}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{w.detail}</p>
                  {w.hint && (
                    <p className="text-xs text-blue-600 mt-1 italic">💡 {w.hint}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <a
          href="/admin/dlr/production"
          className="text-xs text-blue-600 underline hover:text-blue-800"
        >
          → View production config
        </a>
        <a
          href="/admin/dlr/pre-live"
          className="text-xs text-blue-600 underline hover:text-blue-800"
        >
          → View pre-live checklist
        </a>
        <a
          href="/admin/dlr/first-pilot"
          className="text-xs text-blue-600 underline hover:text-blue-800"
        >
          → Start first pilot
        </a>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Generated {new Date(report.generatedAt).toLocaleString()}
      </p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function GoNoGoPage() {
  const reports = await generateGoNoGoReportAll()

  const goCount   = reports.filter(r => r.verdict === 'go').length
  const noGoCount = reports.filter(r => r.verdict === 'no_go').length
  const allGo     = noGoCount === 0

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Go / No-Go Report</h1>
        <p className="mt-1 text-sm text-gray-500">
          Authoritative pre-flight verdict for the first live SMS pilot.
          Combines the Telnyx config audit and the pre-live compliance checklist.
          All blockers must be cleared before sending any live messages.
        </p>
      </div>

      {/* Global banner */}
      {reports.length > 0 && (
        <div className={`rounded-lg border px-5 py-4 flex items-center gap-4 ${
          allGo ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
        }`}>
          <span className="text-2xl">{allGo ? '✅' : '🚫'}</span>
          <div>
            <p className={`font-bold text-sm ${allGo ? 'text-emerald-900' : 'text-red-900'}`}>
              {allGo
                ? reports.length === 1
                  ? 'Tenant is cleared for first live pilot'
                  : `All ${reports.length} tenants are cleared for first live pilot`
                : `${noGoCount} tenant${noGoCount !== 1 ? 's' : ''} not cleared — blockers must be resolved`}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              {goCount > 0 && noGoCount > 0 && `${goCount} cleared, ${noGoCount} blocked`}
              {allGo && reports.some(r => r.warningCount > 0) && 'Review warnings before scaling beyond the first pilot.'}
            </p>
          </div>
        </div>
      )}

      {reports.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-12">No tenants found.</p>
      )}

      {/* Per-tenant verdict cards — no_go first, then go */}
      <div className="space-y-6">
        {reports.map(report => (
          <VerdictCard key={report.tenantId} report={report} />
        ))}
      </div>

      {/* How to clear blockers */}
      {noGoCount > 0 && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-5 py-4 text-xs text-gray-500 space-y-1.5">
          <p className="font-semibold text-gray-700">How to clear blockers:</p>
          <p>• <strong>Env vars:</strong> Set <code className="bg-gray-100 px-1 rounded">TELNYX_API_KEY</code>, <code className="bg-gray-100 px-1 rounded">TELNYX_PUBLIC_KEY</code>, <code className="bg-gray-100 px-1 rounded">SMS_LIVE_MODE</code> in your production environment</p>
          <p>• <strong>10DLC fields:</strong> Go to <a href="/admin/dlr/production" className="text-blue-600 underline">Production Config</a> → 10DLC Submission Readiness section for field-level guidance</p>
          <p>• <strong>Brand / campaign status:</strong> Register at TCR via Telnyx → 10DLC → Brands and Campaigns, then update tenant fields once approved</p>
          <p>• <strong>Workflow approval:</strong> Go to the <a href="/admin/dlr/readiness" className="text-blue-600 underline">Readiness panel</a> to approve workflows</p>
          <p>• <strong>Webhook signature:</strong> Copy Ed25519 public key from Telnyx portal → Messaging → Webhooks</p>
          <p>• <strong>Sending number / messaging profile:</strong> Purchase a Telnyx number, create a messaging profile, then set both on the tenant record</p>
        </div>
      )}
    </div>
  )
}

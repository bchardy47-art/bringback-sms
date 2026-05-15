/**
 * Phase 10 — Pre-Live Compliance Checklist
 * /admin/dlr/pre-live
 *
 * Shows the full operational/compliance readiness state before the first live
 * pilot. Displays blockers and warnings for each tenant.
 * "Do not go live until all blockers are clear."
 */

import { runPreLiveChecklistAll, type PreLiveChecklistResult, type CheckStatus } from '@/lib/pilot/pre-live-checklist'

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_ICON: Record<CheckStatus, string> = {
  ok:      '✓',
  warning: '⚠',
  blocker: '✗',
}

const STATUS_STYLE: Record<CheckStatus, string> = {
  ok:      'text-emerald-700',
  warning: 'text-amber-600',
  blocker: 'text-red-600',
}

const STATUS_ROW_STYLE: Record<CheckStatus, string> = {
  ok:      'bg-white border-gray-100',
  warning: 'bg-amber-50 border-amber-100',
  blocker: 'bg-red-50 border-red-100',
}

const BADGE_STYLE: Record<CheckStatus, string> = {
  ok:      'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  blocker: 'bg-red-100 text-red-700',
}

// ── Components ─────────────────────────────────────────────────────────────────

function BlockerBanner({ result }: { result: PreLiveChecklistResult }) {
  if (!result.blocked && result.warningCount === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
        <span className="text-emerald-600 text-xl">✓</span>
        <div>
          <p className="font-semibold text-emerald-800 text-sm">All blockers cleared</p>
          <p className="text-emerald-700 text-xs">No blockers or warnings for {result.tenantName}. System is pre-live ready.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${result.blocked ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
      <span className={`text-xl ${result.blocked ? 'text-red-500' : 'text-amber-500'}`}>
        {result.blocked ? '✗' : '⚠'}
      </span>
      <div>
        <p className={`font-semibold text-sm ${result.blocked ? 'text-red-800' : 'text-amber-800'}`}>
          {result.blocked
            ? `Do not go live — ${result.blockerCount} blocker${result.blockerCount !== 1 ? 's' : ''} must be cleared first`
            : `${result.warningCount} warning${result.warningCount !== 1 ? 's' : ''} — review before going live`}
        </p>
        <p className={`text-xs ${result.blocked ? 'text-red-700' : 'text-amber-700'}`}>
          Generated {new Date(result.generatedAt).toLocaleString()}
        </p>
      </div>
    </div>
  )
}

function ChecklistSection({
  section,
}: {
  section: PreLiveChecklistResult['sections'][number]
}) {
  const blockers = section.checks.filter(c => c.status === 'blocker').length
  const warnings = section.checks.filter(c => c.status === 'warning').length
  const allOk    = blockers === 0 && warnings === 0

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Section header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${
        blockers > 0 ? 'bg-red-50 border-red-200' :
        warnings > 0 ? 'bg-amber-50 border-amber-200' :
        'bg-gray-50 border-gray-200'
      }`}>
        <h3 className="font-semibold text-sm text-gray-900">{section.title}</h3>
        <div className="flex items-center gap-2">
          {blockers > 0 && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
              {blockers} blocker{blockers !== 1 ? 's' : ''}
            </span>
          )}
          {warnings > 0 && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
              {warnings} warning{warnings !== 1 ? 's' : ''}
            </span>
          )}
          {allOk && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
              All clear
            </span>
          )}
        </div>
      </div>

      {/* Checks */}
      <div className="divide-y divide-gray-100">
        {section.checks.map(check => (
          <div
            key={check.id}
            className={`px-4 py-2.5 border-l-2 flex items-start gap-3 ${STATUS_ROW_STYLE[check.status]} ${
              check.status === 'blocker' ? 'border-l-red-400' :
              check.status === 'warning' ? 'border-l-amber-400' :
              'border-l-emerald-400'
            }`}
          >
            <span className={`mt-0.5 text-sm font-bold flex-shrink-0 w-4 text-center ${STATUS_STYLE[check.status]}`}>
              {STATUS_ICON[check.status]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gray-800">{check.label}</p>
              <p className="text-xs text-gray-600 mt-0.5">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TenantChecklist({ result }: { result: PreLiveChecklistResult }) {
  return (
    <div className="space-y-4">
      <BlockerBanner result={result} />

      <div className="grid grid-cols-1 gap-4">
        {result.sections.map(section => (
          <ChecklistSection key={section.id} section={section} />
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PreLivePage() {
  const results = await runPreLiveChecklistAll()

  const totalBlockers = results.reduce((sum, r) => sum + r.blockerCount, 0)
  const totalWarnings = results.reduce((sum, r) => sum + r.warningCount, 0)
  const anyBlocked    = results.some(r => r.blocked)

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pre-Live Compliance Checklist</h1>
        <p className="mt-1 text-sm text-gray-500">
          All blockers must be cleared before the first live SMS pilot.
          This page is read-only — go to the{' '}
          <a href="/admin/dlr/readiness" className="text-blue-600 underline">Readiness panel</a>{' '}
          to resolve issues.
        </p>
      </div>

      {/* Global summary */}
      {results.length > 1 && (
        <div className={`rounded-lg border px-5 py-4 flex items-center gap-4 ${
          anyBlocked ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'
        }`}>
          <span className={`text-2xl ${anyBlocked ? 'text-red-500' : 'text-emerald-500'}`}>
            {anyBlocked ? '✗' : '✓'}
          </span>
          <div>
            <p className={`font-bold text-sm ${anyBlocked ? 'text-red-900' : 'text-emerald-900'}`}>
              {anyBlocked
                ? `${totalBlockers} blocker${totalBlockers !== 1 ? 's' : ''} across ${results.filter(r => r.blocked).length} tenant${results.filter(r => r.blocked).length !== 1 ? 's' : ''}`
                : 'All tenants clear — no blockers found'}
            </p>
            {totalWarnings > 0 && (
              <p className="text-xs text-gray-600 mt-0.5">
                {totalWarnings} warning{totalWarnings !== 1 ? 's' : ''} to review
              </p>
            )}
          </div>
        </div>
      )}

      {results.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No tenants found.</p>
        </div>
      )}

      {/* Per-tenant results */}
      {results.map(result => (
        <div key={result.tenantId} className="space-y-4">
          {results.length > 1 && (
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">{result.tenantName}</h2>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                result.blocked
                  ? 'bg-red-100 text-red-700'
                  : result.warningCount > 0
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}>
                {result.blocked ? `${result.blockerCount} blockers` :
                 result.warningCount > 0 ? `${result.warningCount} warnings` :
                 'All clear'}
              </span>
            </div>
          )}
          <TenantChecklist result={result} />
        </div>
      ))}

      {/* Instructions */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-5 py-4 text-xs text-gray-500 space-y-1">
        <p className="font-semibold text-gray-700">How to clear blockers:</p>
        <p>• <strong>Sending number / 10DLC:</strong> Set via the Readiness panel → Telnyx fields, or via the admin API</p>
        <p>• <strong>Brand / campaign status:</strong> Register at TCR (via Telnyx) and update the status fields once approved</p>
        <p>• <strong>Opt-out footer:</strong> Edit the workflow step template to include an <code className="bg-gray-100 px-1 rounded">optOutFooter</code> (e.g. "Reply STOP to unsubscribe.")</p>
        <p>• <strong>Workflow approval:</strong> Go to the Readiness panel → Workflow section → Approve</p>
        <p>• <strong>Consent data:</strong> Enrich leads with <code className="bg-gray-100 px-1 rounded">consentStatus</code> from your CRM or import source</p>
        <p>• <strong>Webhook signature:</strong> Set <code className="bg-gray-100 px-1 rounded">TELNYX_PUBLIC_KEY</code> environment variable</p>
      </div>
    </div>
  )
}

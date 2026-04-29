'use server'

/**
 * Phase 12 — Telnyx Production Configuration
 * /admin/dlr/production
 *
 * Shows the full Telnyx configuration audit: env vars, tenant config,
 * webhook setup, and 10DLC submission readiness. Also displays the sample
 * message library for 10DLC campaign submission.
 */

import { runTelnyxConfigAudit, type TelnyxConfigAuditResult, type AuditSeverity } from '@/lib/telnyx/config-audit'
import { getSampleMessages, generateTcrSampleSet, type SampleMessage } from '@/lib/pilot/sample-messages'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'

// ── Status helpers ─────────────────────────────────────────────────────────────

const SEVERITY_ICON: Record<AuditSeverity, string> = {
  ok:      '✓',
  warning: '⚠',
  blocker: '✗',
}

const SEVERITY_LABEL: Record<AuditSeverity, string> = {
  ok:      'OK',
  warning: 'Warning',
  blocker: 'Blocker',
}

const SEVERITY_TEXT: Record<AuditSeverity, string> = {
  ok:      'text-emerald-700',
  warning: 'text-amber-600',
  blocker: 'text-red-600',
}

const SEVERITY_ROW: Record<AuditSeverity, string> = {
  ok:      'bg-white border-gray-100',
  warning: 'bg-amber-50 border-amber-100',
  blocker: 'bg-red-50 border-red-100',
}

const SEVERITY_LEFT: Record<AuditSeverity, string> = {
  ok:      'border-l-emerald-400',
  warning: 'border-l-amber-400',
  blocker: 'border-l-red-400',
}

const SEVERITY_BADGE: Record<AuditSeverity, string> = {
  ok:      'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  blocker: 'bg-red-100 text-red-700',
}

// ── Components ─────────────────────────────────────────────────────────────────

function VerdictBanner({ audit }: { audit: TelnyxConfigAuditResult }) {
  if (!audit.blocked && audit.warningCount === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
        <span className="text-emerald-600 text-xl">✓</span>
        <div>
          <p className="font-semibold text-emerald-800 text-sm">Production config fully cleared</p>
          <p className="text-emerald-700 text-xs">All checks passed for {audit.tenantName}. Generated {new Date(audit.generatedAt).toLocaleString()}</p>
        </div>
      </div>
    )
  }

  const color = audit.blocked ? 'red' : 'amber'
  return (
    <div className={`rounded-lg border border-${color}-200 bg-${color}-50 px-4 py-3 flex items-center gap-3`}>
      <span className={`text-xl text-${color}-500`}>{audit.blocked ? '✗' : '⚠'}</span>
      <div>
        <p className={`font-semibold text-sm text-${color}-800`}>
          {audit.blocked
            ? `${audit.blockerCount} blocker${audit.blockerCount !== 1 ? 's' : ''} must be resolved before going live`
            : `${audit.warningCount} warning${audit.warningCount !== 1 ? 's' : ''} — review before going live`}
        </p>
        <p className={`text-xs text-${color}-700`}>
          Generated {new Date(audit.generatedAt).toLocaleString()}
        </p>
      </div>
    </div>
  )
}

function AuditSection({
  section,
}: {
  section: TelnyxConfigAuditResult['sections'][number]
}) {
  const blockers = section.checks.filter(c => c.severity === 'blocker').length
  const warnings = section.checks.filter(c => c.severity === 'warning').length
  const allOk    = blockers === 0 && warnings === 0

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
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

      <div className="divide-y divide-gray-100">
        {section.checks.map(check => (
          <div
            key={check.id}
            className={`px-4 py-3 border-l-2 flex items-start gap-3 ${SEVERITY_ROW[check.severity]} ${SEVERITY_LEFT[check.severity]}`}
          >
            <span className={`mt-0.5 text-sm font-bold flex-shrink-0 w-4 text-center ${SEVERITY_TEXT[check.severity]}`}>
              {SEVERITY_ICON[check.severity]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-semibold text-gray-800">{check.label}</p>
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${SEVERITY_BADGE[check.severity]}`}>
                  {SEVERITY_LABEL[check.severity]}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{check.detail}</p>
              {check.hint && (
                <p className="text-xs text-blue-600 mt-1 italic">💡 {check.hint}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SampleMessageCard({ sample, index }: { sample: SampleMessage; index: number }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500 bg-gray-200 rounded-full w-5 h-5 flex items-center justify-center">
            {index + 1}
          </span>
          <p className="text-xs font-semibold text-gray-800">{sample.label}</p>
        </div>
        <div className="flex items-center gap-2">
          {sample.hasOptOut && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
              Has opt-out
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
            Step {sample.stepPosition}
          </span>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="bg-gray-50 rounded border border-gray-200 px-3 py-2">
          <p className="text-xs text-gray-800 leading-relaxed font-mono">{sample.rendered}</p>
        </div>
        <p className="text-xs text-gray-500 italic">{sample.context}</p>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ProductionPage() {
  const allTenants = await db.query.tenants.findMany()
  const audits: TelnyxConfigAuditResult[] = await Promise.all(
    allTenants.map(t => runTelnyxConfigAudit(t.id))
  )

  const samples      = getSampleMessages()
  const tcrSamples   = generateTcrSampleSet(6)

  const totalBlockers = audits.reduce((sum, a) => sum + a.blockerCount, 0)
  const totalWarnings = audits.reduce((sum, a) => sum + a.warningCount, 0)
  const anyBlocked    = audits.some(a => a.blocked)

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-10">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Production Configuration</h1>
        <p className="mt-1 text-sm text-gray-500">
          Telnyx environment audit, 10DLC submission readiness, and sample message library.
          All checks are read-only.
        </p>
      </div>

      {/* Global summary */}
      {audits.length > 1 && (
        <div className={`rounded-lg border px-5 py-4 flex items-center gap-4 ${
          anyBlocked ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'
        }`}>
          <span className={`text-2xl ${anyBlocked ? 'text-red-500' : 'text-emerald-500'}`}>
            {anyBlocked ? '✗' : '✓'}
          </span>
          <div>
            <p className={`font-bold text-sm ${anyBlocked ? 'text-red-900' : 'text-emerald-900'}`}>
              {anyBlocked
                ? `${totalBlockers} blocker${totalBlockers !== 1 ? 's' : ''} across ${audits.filter(a => a.blocked).length} tenant${audits.filter(a => a.blocked).length !== 1 ? 's' : ''}`
                : 'All tenants cleared — no production blockers'}
            </p>
            {totalWarnings > 0 && (
              <p className="text-xs text-gray-600 mt-0.5">
                {totalWarnings} warning{totalWarnings !== 1 ? 's' : ''} to review
              </p>
            )}
          </div>
        </div>
      )}

      {audits.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-12">No tenants found.</p>
      )}

      {/* Per-tenant audit results */}
      {audits.map(audit => (
        <div key={audit.tenantId} className="space-y-4">
          {audits.length > 1 && (
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">{audit.tenantName}</h2>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                audit.blocked
                  ? 'bg-red-100 text-red-700'
                  : audit.warningCount > 0
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}>
                {audit.blocked ? `${audit.blockerCount} blockers` :
                 audit.warningCount > 0 ? `${audit.warningCount} warnings` : 'All clear'}
              </span>
            </div>
          )}
          <VerdictBanner audit={audit} />
          <div className="grid grid-cols-1 gap-4">
            {audit.sections.map(section => (
              <AuditSection key={section.id} section={section} />
            ))}
          </div>
        </div>
      ))}

      {/* Sample message library */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">10DLC Sample Message Library</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {samples.length} sample messages derived from production workflow templates. TCR requires at least 2 for campaign submission.
            All samples include sender identity, clear context, and opt-out language where required.
          </p>
        </div>

        {/* TCR submission set */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm font-semibold text-blue-800">Recommended TCR Submission Set ({tcrSamples.length} messages)</p>
          <p className="text-xs text-blue-700 mt-0.5">
            Copy these rendered messages into your TCR campaign submission form.
            Each message is a step-1 outreach with opt-out language and dealership identity.
          </p>
        </div>

        <div className="space-y-3">
          {tcrSamples.map((sample, i) => (
            <SampleMessageCard key={sample.id} sample={sample} index={i} />
          ))}
        </div>

        {/* Full library (collapsible feel via section separator) */}
        {samples.length > tcrSamples.length && (
          <>
            <div className="flex items-center gap-3 pt-2">
              <div className="h-px bg-gray-200 flex-1" />
              <p className="text-xs text-gray-400 font-medium">ALL {samples.length} SAMPLES</p>
              <div className="h-px bg-gray-200 flex-1" />
            </div>
            <div className="space-y-3">
              {samples.filter(s => !tcrSamples.find(t => t.id === s.id)).map((sample, i) => (
                <SampleMessageCard key={sample.id} sample={sample} index={tcrSamples.length + i} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Instructions */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-5 py-4 text-xs text-gray-500 space-y-1.5">
        <p className="font-semibold text-gray-700">10DLC submission checklist:</p>
        <p>1. Complete <strong>TCR brand registration</strong> via Telnyx → 10DLC → Brands. Requires business name, EIN, address, website.</p>
        <p>2. Create a <strong>TCR campaign</strong> via Telnyx → 10DLC → Campaigns. Select use-case (MIXED), paste the sample messages above.</p>
        <p>3. Once approved, record the <strong>campaign ID</strong> and <strong>messaging profile ID</strong> on the tenant record.</p>
        <p>4. Set <strong>TELNYX_PUBLIC_KEY</strong> from the Telnyx portal (Messaging → Webhooks → Public Key).</p>
        <p>5. Register your <strong>webhook URL</strong>: <code className="bg-gray-100 px-1 rounded">[your-domain]/api/webhooks/telnyx</code> in Telnyx → Messaging → Messaging Profiles.</p>
        <p>6. Run the <a href="/admin/dlr/go-no-go" className="text-blue-600 underline">Go / No-Go report</a> to confirm all blockers are cleared.</p>
      </div>
    </div>
  )
}

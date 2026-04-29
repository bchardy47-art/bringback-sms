/**
 * Phase 12 — Go / No-Go Report
 *
 * Aggregates all pre-flight checks into a single authoritative go/no-go
 * decision for the first live pilot. Combines:
 *
 *   1. Telnyx config audit (env vars, tenant config, webhooks, 10DLC fields)
 *   2. Pre-live checklist (10DLC status, consent, workflows, pilot batch,
 *      emergency controls, webhook routes)
 *
 * The report blocks on ANY blocker from either source. Warnings are surfaced
 * but do not block.
 *
 * This is a pure read — no DB writes, no side effects.
 */

import { runTelnyxConfigAudit, type TelnyxConfigAuditResult } from '@/lib/telnyx/config-audit'
import { runPreLiveChecklist, type PreLiveChecklistResult } from '@/lib/pilot/pre-live-checklist'

// ── Types ──────────────────────────────────────────────────────────────────────

export type GoNoGoVerdict = 'go' | 'no_go'

export type GoNoGoBlocker = {
  source: 'telnyx_audit' | 'pre_live_checklist'
  sectionId: string
  sectionTitle: string
  checkId: string
  checkLabel: string
  detail: string
  hint?: string
}

export type GoNoGoWarning = {
  source: 'telnyx_audit' | 'pre_live_checklist'
  sectionId: string
  sectionTitle: string
  checkId: string
  checkLabel: string
  detail: string
  hint?: string
}

export type GoNoGoReport = {
  tenantId: string
  tenantName: string
  generatedAt: string
  verdict: GoNoGoVerdict
  blockerCount: number
  warningCount: number
  blockers: GoNoGoBlocker[]
  warnings: GoNoGoWarning[]
  /** Full audit result for detailed display */
  telnyxAudit: TelnyxConfigAuditResult
  /** Full pre-live checklist result for detailed display */
  preLiveChecklist: PreLiveChecklistResult
  /** Concise human-readable summary */
  summary: string
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Generate a go/no-go report for a tenant.
 *
 * Runs both the Telnyx config audit and the pre-live checklist in parallel,
 * then merges all blockers and warnings into a single authoritative verdict.
 *
 * @param tenantId - The tenant to evaluate
 * @returns GoNoGoReport with verdict, all blockers/warnings, and full sub-reports
 */
export async function generateGoNoGoReport(tenantId: string): Promise<GoNoGoReport> {
  // Run both checks in parallel — neither depends on the other
  const [telnyxAudit, preLiveChecklist] = await Promise.all([
    runTelnyxConfigAudit(tenantId),
    runPreLiveChecklist(tenantId),
  ])

  const blockers: GoNoGoBlocker[] = []
  const warnings: GoNoGoWarning[] = []

  // Extract blockers and warnings from Telnyx audit
  for (const section of telnyxAudit.sections) {
    for (const check of section.checks) {
      if (check.severity === 'blocker') {
        blockers.push({
          source: 'telnyx_audit',
          sectionId: section.id,
          sectionTitle: section.title,
          checkId: check.id,
          checkLabel: check.label,
          detail: check.detail,
          hint: check.hint,
        })
      } else if (check.severity === 'warning') {
        warnings.push({
          source: 'telnyx_audit',
          sectionId: section.id,
          sectionTitle: section.title,
          checkId: check.id,
          checkLabel: check.label,
          detail: check.detail,
          hint: check.hint,
        })
      }
    }
  }

  // Extract blockers and warnings from pre-live checklist
  for (const section of preLiveChecklist.sections) {
    for (const check of section.checks) {
      if (check.status === 'blocker') {
        blockers.push({
          source: 'pre_live_checklist',
          sectionId: section.id,
          sectionTitle: section.title,
          checkId: check.id,
          checkLabel: check.label,
          detail: check.detail,
        })
      } else if (check.status === 'warning') {
        warnings.push({
          source: 'pre_live_checklist',
          sectionId: section.id,
          sectionTitle: section.title,
          checkId: check.id,
          checkLabel: check.label,
          detail: check.detail,
        })
      }
    }
  }

  const blockerCount = blockers.length
  const warningCount = warnings.length
  const verdict: GoNoGoVerdict = blockerCount > 0 ? 'no_go' : 'go'

  const summary = buildSummary(verdict, blockerCount, warningCount, telnyxAudit.tenantName)

  return {
    tenantId,
    tenantName: telnyxAudit.tenantName,
    generatedAt: new Date().toISOString(),
    verdict,
    blockerCount,
    warningCount,
    blockers,
    warnings,
    telnyxAudit,
    preLiveChecklist,
    summary,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSummary(
  verdict: GoNoGoVerdict,
  blockerCount: number,
  warningCount: number,
  tenantName: string,
): string {
  if (verdict === 'go') {
    if (warningCount === 0) {
      return `✅ GO — ${tenantName} is fully cleared for first live pilot. All checks passed with no warnings.`
    }
    return `✅ GO — ${tenantName} is cleared for first live pilot with ${warningCount} warning(s). Review warnings before scaling up.`
  }

  if (blockerCount === 1) {
    return `🚫 NO GO — ${tenantName} has 1 blocker that must be resolved before sending any live messages.`
  }
  return `🚫 NO GO — ${tenantName} has ${blockerCount} blockers that must be resolved before sending any live messages.`
}

/**
 * Generate go/no-go reports for all tenants.
 * Returns reports sorted: no_go first, then go (both by tenant name).
 */
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'

export async function generateGoNoGoReportAll(): Promise<GoNoGoReport[]> {
  const allTenants = await db.query.tenants.findMany()
  const reports = await Promise.all(allTenants.map(t => generateGoNoGoReport(t.id)))

  return reports.sort((a, b) => {
    if (a.verdict !== b.verdict) return a.verdict === 'no_go' ? -1 : 1
    return a.tenantName.localeCompare(b.tenantName)
  })
}

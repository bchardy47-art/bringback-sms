/**
 * /dealer/import
 *
 * Dealer-facing lead import page. Identical to the admin pilot-leads page
 * except:
 *  - tenantId is locked to session.user.tenantId (no tenant switcher)
 *  - Back-links go to dealer routes
 *  - "Created By" labelled as dealer's name, not operator
 */

import { db } from '@/lib/db'
import { pilotLeadImports, workflows, leads } from '@/lib/db/schema'
import { eq, and, ne, inArray } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getDealerSession } from '@/lib/dealer/dev-auth-bypass'
import { DealerImportForm } from './DealerImportForm'
import { DealerConsentGate } from './DealerConsentGate'
import {
  AutoSelectEligible,
  BulkClearButton,
  MarkReviewedButton,
  DryRunReportPanel,
  StatusFilterSelect,
  LeadCheckbox,
  ExcludeButton,
  CreateBatchButton,
  type BucketPlanItem,
} from '@/app/(dashboard)/admin/dlr/pilot-leads/LeadReviewControls'
import type { PilotPreviewMessage } from '@/lib/db/schema'
import { FIRST_PILOT_CAP, type AgeBucket } from '@/lib/db/schema'
import { DEALER_BUCKET_LABEL } from '@/lib/pilot/age-classification'
import { DlrHeroArt } from '@/components/dealer/DlrHeroArt'
import { ShieldCheck, CheckCircle2, AlertTriangle, Upload } from 'lucide-react'

// ── Style maps (duplicated from admin page for independence) ──────────────────

const STATUS_STYLE: Record<string, string> = {
  eligible:     'bg-emerald-950/60 text-emerald-400 border border-emerald-700/40',
  warning:      'bg-amber-950/60 text-amber-400 border border-amber-700/40',
  blocked:      'bg-red-950/60 text-red-400 border border-red-700/40',
  selected:     'bg-blue-950/60 text-blue-400 border border-blue-700/40',
  excluded:     'bg-white/5 text-white/35 border border-white/10',
  pending:      'bg-white/5 text-white/45 border border-white/10',
  held:         'bg-violet-950/60 text-violet-400 border border-violet-700/40',
  needs_review: 'bg-orange-950/60 text-orange-400 border border-orange-700/40',
}

const STATUS_LABEL: Record<string, string> = {
  eligible:     '✓ Eligible',
  warning:      '⚠ Warning',
  blocked:      '✗ Blocked',
  selected:     '● Selected',
  excluded:     '— Excluded',
  pending:      '… Pending',
  held:         '⏳ Held',
  needs_review: '? Needs Date',
}

const BUCKET_COLOR: Record<AgeBucket, { bg: string; text: string; border: string }> = {
  a: { bg: 'bg-emerald-950/60', text: 'text-emerald-400', border: 'border-emerald-700/40' },
  b: { bg: 'bg-blue-950/60',    text: 'text-blue-400',    border: 'border-blue-700/40'    },
  c: { bg: 'bg-amber-950/60',   text: 'text-amber-400',   border: 'border-amber-700/40'   },
  d: { bg: 'bg-orange-950/60',  text: 'text-orange-400',  border: 'border-orange-700/40'  },
}

const CONSENT_STYLE: Record<string, string> = {
  explicit: 'text-emerald-400',
  implied:  'text-amber-400',
  unknown:  'text-orange-400 font-semibold',
  revoked:  'text-red-400 font-semibold',
}

const CONSENT_LABEL: Record<string, string> = {
  explicit: 'explicit',
  implied:  'implied',
  unknown:  'unknown ⛔ not eligible yet',
  revoked:  'revoked ⛔ hard block',
}

function friendlyWarning(raw: string): string {
  if (raw.startsWith('Contact date missing — imported before age classification was wired')) {
    return 'Missing contact date — re-upload this lead with a contact date to include it.'
  }
  return raw
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DealerImportPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  const session = await getDealerSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'dealer') redirect('/dashboard')

  const tenantId     = session.user.tenantId
  const statusFilter = searchParams.status ?? ''

  const tenantWorkflows = await db
    .select({ id: workflows.id, name: workflows.name })
    .from(workflows)
    .where(eq(workflows.tenantId, tenantId))
    .orderBy(workflows.name)
  void tenantWorkflows

  const testLeadIds = new Set(
    (await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), eq(leads.isTest, true)))
    ).map(r => r.id),
  )

  const allLeadsRaw = await db
    .select()
    .from(pilotLeadImports)
    .where(and(
      eq(pilotLeadImports.tenantId, tenantId),
      ne(pilotLeadImports.importStatus, 'excluded'),
    ))
    .orderBy(pilotLeadImports.createdAt)

  const allLeads = allLeadsRaw.filter(r =>
    r.importStatus !== 'warning' &&
    r.importStatus !== 'held' &&
    !(r.leadId && testLeadIds.has(r.leadId)) &&
    !(r.importStatus === 'selected' && r.leadId == null),
  )

  const displayLeads = statusFilter
    ? allLeads.filter(r => r.importStatus === statusFilter)
    : allLeads

  const selectedCount     = allLeads.filter(r => r.importStatus === 'selected').length
  const eligibleCount     = allLeads.filter(r => ['eligible', 'warning', 'selected'].includes(r.importStatus)).length
  const blockedCount      = allLeads.filter(r => r.importStatus === 'blocked').length
  const heldCount         = allLeads.filter(r => r.importStatus === 'held').length
  const needsReviewCount  = allLeads.filter(r =>
    r.contactDate == null &&
    r.importStatus !== 'blocked' &&
    r.importStatus !== 'excluded'
  ).length

  const selectedLeads    = allLeads.filter(r => r.importStatus === 'selected')
  const selectedImportIds = selectedLeads.map(r => r.id)

  const assignedWorkflowIds = Array.from(
    new Set(selectedLeads.map(r => r.assignedWorkflowId).filter(Boolean) as string[]),
  )
  const bucketWorkflowDetails = assignedWorkflowIds.length > 0
    ? await db
        .select({ id: workflows.id, name: workflows.name, ageBucket: workflows.ageBucket })
        .from(workflows)
        .where(inArray(workflows.id, assignedWorkflowIds))
    : []
  const wfById = new Map(bucketWorkflowDetails.map(w => [w.id, w]))

  const bucketPlanMap = new Map<string, BucketPlanItem>()
  for (const lead of selectedLeads) {
    if (!lead.assignedWorkflowId) continue
    const wf = wfById.get(lead.assignedWorkflowId)
    if (!wf) continue
    if (!bucketPlanMap.has(lead.assignedWorkflowId)) {
      bucketPlanMap.set(lead.assignedWorkflowId, {
        workflowId:   wf.id,
        workflowName: wf.name,
        ageBucket:    wf.ageBucket,
        bucketLabel:  wf.ageBucket ? DEALER_BUCKET_LABEL[wf.ageBucket as AgeBucket] : 'Unknown',
        leadCount:    0,
      })
    }
    bucketPlanMap.get(lead.assignedWorkflowId)!.leadCount++
  }
  const bucketPlan = Array.from(bucketPlanMap.values())
    .sort((a, b) => (a.ageBucket ?? 'z').localeCompare(b.ageBucket ?? 'z'))

  const actionableLeads = displayLeads.filter(r => r.importStatus !== 'blocked')
  const blockedLeads    = displayLeads.filter(r => r.importStatus === 'blocked')

  const apiBase = '/api/dealer/pilot-leads'

  const leadsReady = selectedCount > 0 && bucketPlan.length > 0
  const importedCount = allLeads.length

  // Six age-grouping metrics for the neon card row.
  type AgeAccent = 'green' | 'violet' | 'amber' | 'red' | null
  const ageMetrics: Array<{ label: string; value: number; accent: AgeAccent }> = [
    { label: 'Imported',   value: importedCount,    accent: null },
    { label: 'Ready',      value: eligibleCount,    accent: importedCount > 0 && eligibleCount > 0 ? 'green' : null },
    { label: 'Held',       value: heldCount,        accent: heldCount > 0 ? 'violet' : null },
    { label: 'Needs Date', value: needsReviewCount, accent: needsReviewCount > 0 ? 'amber' : null },
    { label: 'Blocked',    value: blockedCount,     accent: blockedCount > 0 ? 'red' : null },
    {
      label: bucketPlan.length > 1 ? 'Selected across groups' :
             bucketPlan.length === 1 ? 'Selected for group' : 'Selected',
      value: selectedCount,
      accent: selectedCount > 0 ? 'red' : null,
    },
  ]

  return (
    <div className="dlr-app-bg min-h-full text-white">

      {/* ── HERO ───────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{
          minHeight: 240,
          borderBottom: '1px solid rgba(255,27,27,0.28)',
        }}
      >
        <DlrHeroArt intensity="high" showTruck />
        <div className="relative z-10 px-4 md:px-8 lg:px-10 py-8 md:py-10">
          <p className="dlr-cmd-label" style={{ color: '#ff5252' }}>Lead Operations</p>
          <h1 className="dlr-headline mt-2" style={{ fontSize: 'clamp(32px, 4.6vw, 56px)' }}>
            Upload Leads
          </h1>
          <p className="mt-4 max-w-2xl text-sm md:text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
            DLR uses the original inquiry date to group leads into safe follow-up
            campaigns.{' '}
            <span className="font-bold" style={{ color: '#ff5252' }}>
              No messages are sent from this page.
            </span>{' '}
            Leads are validated, grouped, and queued for your campaign review.
          </p>
        </div>
      </section>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 lg:px-10 py-6 md:py-8 space-y-6">

        {/* ── Review status card ─────────────────────────────────── */}
        <div
          className="dlr-card overflow-hidden"
          style={{
            ...(leadsReady
              ? {
                  borderColor: 'rgba(34,197,94,0.55)',
                  boxShadow:
                    '0 0 0 1px rgba(34,197,94,0.18), 0 0 30px rgba(34,197,94,0.22), var(--dlr-shadow-card)',
                }
              : importedCount > 0
              ? {
                  borderColor: 'rgba(255,27,27,0.55)',
                  boxShadow:
                    '0 0 0 1px rgba(255,27,27,0.18), 0 0 30px rgba(255,27,27,0.25), var(--dlr-shadow-card)',
                }
              : {}),
          }}
        >
          <div className="p-5 flex items-start gap-4">
            <span
              className="flex-shrink-0 inline-flex items-center justify-center rounded-full"
              style={{
                width: 56,
                height: 56,
                background: leadsReady
                  ? 'rgba(34,197,94,0.14)'
                  : 'rgba(255,27,27,0.14)',
                border: leadsReady
                  ? '1px solid rgba(34,197,94,0.5)'
                  : '1px solid rgba(255,27,27,0.5)',
                color: leadsReady ? '#4ade80' : '#ff5252',
                boxShadow: leadsReady
                  ? '0 0 22px rgba(34,197,94,0.45)'
                  : '0 0 22px rgba(255,27,27,0.45)',
              }}
            >
              {leadsReady ? <CheckCircle2 size={26} /> : <ShieldCheck size={26} />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="dlr-cmd-label" style={{ color: leadsReady ? '#4ade80' : '#ff5252' }}>
                Review Status
              </p>
              <h2 className="text-white text-xl md:text-2xl font-black mt-1 leading-tight">
                {leadsReady
                  ? 'Leads are ready for review'
                  : importedCount > 0
                  ? 'Leads imported — select to prepare campaigns'
                  : 'Ready to receive your first upload'}
              </h2>
              <p className="text-sm mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>
                {leadsReady ? (
                  <>
                    {selectedCount} lead{selectedCount !== 1 ? 's' : ''} validated and grouped into{' '}
                    {bucketPlan.length} campaign group{bucketPlan.length !== 1 ? 's' : ''}.
                    <span className="font-bold ml-1" style={{ color: '#fff' }}>
                      No messages are sent from this page.
                    </span>
                  </>
                ) : importedCount > 0 ? (
                  <>
                    {importedCount} lead{importedCount !== 1 ? 's' : ''} imported and validated. Pick eligible leads below
                    to assemble your first campaign — no messages send until you and DLR
                    review the previews.
                  </>
                ) : (
                  <>Upload a CSV below. DLR validates every row, classifies by age, and queues previews for your review.</>
                )}
              </p>
              {leadsReady && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <ReviewPill tone="green">{eligibleCount} ready</ReviewPill>
                  <ReviewPill tone={heldCount > 0 ? 'violet' : 'mute'}>{heldCount} held</ReviewPill>
                  <ReviewPill tone={blockedCount > 0 ? 'red' : 'mute'}>{blockedCount} blocked</ReviewPill>
                  <ReviewPill tone="red">{selectedCount} selected</ReviewPill>
                  <ReviewPill tone="red">
                    {bucketPlan.length} campaign group{bucketPlan.length !== 1 ? 's' : ''}
                  </ReviewPill>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Age grouping cards (6-up neon row) ─────────────────── */}
        {importedCount > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {ageMetrics.map((m) => (
              <AgeMetricCard key={m.label} {...m} />
            ))}
          </div>
        )}

        {heldCount > 0 && (
          <div
            className="rounded-xl px-4 py-3 text-xs leading-relaxed flex items-start gap-2.5"
            style={{
              background: 'rgba(168,85,247,0.12)',
              border: '1px solid rgba(168,85,247,0.4)',
              color: '#e9d5ff',
            }}
          >
            <span style={{ fontSize: 14 }}>⏳</span>
            <span>
              <span className="font-bold">{heldCount} held lead{heldCount !== 1 ? 's' : ''}:</span>{' '}
              held because {heldCount === 1 ? 'this lead is' : 'these leads are'} too fresh for campaign messaging.
              {heldCount === 1 ? ' It' : ' They'}&apos;ll become eligible at the 14-day mark.
            </span>
          </div>
        )}

        {/* ── How DLR groups leads (collapsible) ─────────────────── */}
        <details
          className="group rounded-xl px-4 md:px-5 py-3 md:py-3.5 text-sm"
          style={{
            background: 'rgba(8,8,10,0.7)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.8)',
          }}
        >
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-bold text-white [&::-webkit-details-marker]:hidden">
            <span>How DLR groups leads by age</span>
            <span
              aria-hidden="true"
              className="text-xs transition-transform duration-150 group-open:rotate-180"
              style={{ color: 'rgba(255,255,255,0.45)' }}
            >
              ▾
            </span>
          </summary>
          <div className="mt-4 space-y-3" style={{ color: 'rgba(255,255,255,0.7)' }}>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Nothing is sent from this page — uploading only prepares previews.
            </p>
            <p>
              Include the date each lead originally contacted your store. DLR uses
              that date to group leads into safe follow-up campaigns.
            </p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Common column names we recognize (case-insensitive):
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div>
                <p className="font-bold text-white">Preferred — original inquiry date</p>
                <p className="leading-snug" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  <code>Lead Date</code>, <code>Created Date</code>, <code>Date Created</code>,{' '}
                  <code>Inquiry Date</code>, <code>Submitted Date</code>, <code>Received Date</code>,{' '}
                  <code>Prospect Date</code>, <code>Created</code>
                </p>
              </div>
              <div>
                <p className="font-bold text-white">Fallback — only if no original date</p>
                <p className="leading-snug" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  <code>Last Activity Date</code>, <code>Last Contacted</code>,{' '}
                  <code>Last Contacted Date</code>, bare <code>Date</code>
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <span className="font-bold text-white">Why priority matters:</span>{' '}
              the original inquiry date tells DLR how cold the lead actually is. A
              &ldquo;last activity&rdquo; date is only used when no original column is present
              — it can make a long-cold lead look recent.
            </p>
            <ul className="text-xs space-y-1.5" style={{ color: 'rgba(255,255,255,0.65)' }}>
              <li><span className="font-bold" style={{ color: '#c4b5fd' }}>Held:</span> contacted less than 14 days ago — too fresh for campaign messaging.</li>
              <li><span className="font-bold" style={{ color: '#fbbf24' }}>Needs Date:</span> DLR cannot safely choose a campaign group without a lead date.</li>
              <li><span className="font-bold" style={{ color: '#ff5252' }}>Blocked:</span> phone is invalid, opted out, or revoked consent — DLR will not include the row.</li>
            </ul>
          </div>
        </details>

        {/* ── Auto-select CTA ────────────────────────────────────── */}
        {eligibleCount > 0 && selectedCount === 0 && (
          <div className="dlr-card-red p-5">
            <AutoSelectEligible tenantId={tenantId} apiBase={apiBase} />
          </div>
        )}

        {/* ── Step 1: Upload CSV ─────────────────────────────────── */}
        <section className="dlr-card-red overflow-hidden">
          <header
            className="px-5 py-4 flex items-center gap-3"
            style={{ borderBottom: '1px solid rgba(255,27,27,0.32)' }}
          >
            <span
              className="flex items-center justify-center w-8 h-8 rounded-md text-white text-xs font-black flex-shrink-0"
              style={{
                background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                boxShadow: '0 0 12px rgba(255,27,27,0.55)',
                border: '1px solid rgba(255,80,80,0.7)',
              }}
            >
              1
            </span>
            <div className="flex items-center gap-2">
              <Upload size={16} style={{ color: '#ff5252' }} />
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider">Upload your CSV</h2>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Each row is validated immediately. Nothing is sent until you review
                  and confirm a campaign.
                </p>
              </div>
            </div>
          </header>
          <div className="p-5">
            <DealerConsentGate>
              <DealerImportForm tenantId={tenantId} apiBase={apiBase} />
            </DealerConsentGate>
          </div>
        </section>

        {/* Zero state */}
        {allLeads.length === 0 && (
          <div
            className="rounded-2xl text-center py-10 px-6 space-y-2"
            style={{
              background: 'rgba(8,8,10,0.6)',
              border: '1px dashed rgba(255,27,27,0.4)',
            }}
          >
            <h3 className="text-base font-black uppercase tracking-wider text-white">No leads yet</h3>
            <p className="text-sm max-w-md mx-auto" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Upload a CSV above. After upload, each row is validated and grouped by age,
              and prepares preview campaigns for your review.
            </p>
            <p className="text-xs max-w-md mx-auto" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Nothing is sent until you confirm a campaign. Tip: start with 5–10 leads so you
              have room to exclude any blocked ones.
            </p>
          </div>
        )}

        {/* ── Step 2: Review & select ────────────────────────────── */}
        {allLeads.length > 0 && (
          <section className="dlr-card overflow-hidden">
            <header
              className="px-5 py-4 flex flex-wrap items-center gap-3 justify-between"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex items-center justify-center w-8 h-8 rounded-md text-white text-xs font-black flex-shrink-0"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  2
                </span>
                <div>
                  <h2 className="text-sm font-black text-white uppercase tracking-wider">
                    Review &amp; select{' '}
                    <span className="ml-1.5 font-normal" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      ({displayLeads.length}{statusFilter ? ` of ${allLeads.length}` : ''} lead{displayLeads.length !== 1 ? 's' : ''})
                    </span>
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    Check each lead, then add it to your first campaign selection.
                    No messages are sent from this page.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusFilterSelect tenantId={tenantId} statusFilter={statusFilter} />
                <BulkClearButton tenantId={tenantId} blockedCount={blockedCount} apiBase={apiBase} />
                {selectedCount > 0 && (
                  <span className="dlr-badge dlr-badge-live">
                    {selectedCount} selected
                    {bucketPlan.length > 1 ? ` across ${bucketPlan.length} groups` : ''}
                  </span>
                )}
              </div>
            </header>

            <div>
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                {actionableLeads.map(lead => {
                  const isSelected       = lead.importStatus === 'selected'
                  const consentVal       = (lead.consentStatus ?? 'unknown').toLowerCase().trim()
                  const isUnknownConsent = consentVal === 'unknown' || consentVal === ''
                  const canSelect        = !isUnknownConsent && (isSelected || selectedCount < FIRST_PILOT_CAP)
                  const previews         = (lead.previewMessages as PilotPreviewMessage[] | null) ?? []
                  const bucketColors     = lead.ageBucket ? BUCKET_COLOR[lead.ageBucket as AgeBucket] : null

                  return (
                    <div
                      key={lead.id}
                      className="px-5 py-4 space-y-3 transition-colors"
                      style={{
                        background: isSelected
                          ? 'rgba(59,130,246,0.1)'
                          : lead.reviewed
                          ? 'rgba(34,197,94,0.06)'
                          : 'transparent',
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          <LeadCheckbox
                            leadId={lead.id}
                            tenantId={tenantId}
                            isSelected={isSelected}
                            canSelect={canSelect}
                            apiBase={apiBase}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-white leading-tight">
                              {lead.firstName} {lead.lastName}
                            </p>
                            <span className={`text-xs font-medium ${CONSENT_STYLE[lead.consentStatus] ?? 'text-orange-400 font-semibold'}`}>
                              {CONSENT_LABEL[lead.consentStatus] ?? `${lead.consentStatus ?? 'unknown'} ⛔`}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[lead.importStatus] ?? ''}`}>
                              {STATUS_LABEL[lead.importStatus] ?? lead.importStatus}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                            {lead.email && <span>{lead.email}</span>}
                            {lead.phone && <span className="font-mono">{lead.phone}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <MarkReviewedButton
                            importId={lead.id}
                            tenantId={tenantId}
                            alreadyReviewed={lead.reviewed}
                            apiBase={apiBase}
                          />
                          <ExcludeButton leadId={lead.id} tenantId={tenantId} apiBase={apiBase} />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-7 text-xs">
                        {lead.vehicleOfInterest ? (
                          <span className="font-medium" style={{ color: 'rgba(255,255,255,0.8)' }}>{lead.vehicleOfInterest}</span>
                        ) : (
                          <span className="italic" style={{ color: 'rgba(255,255,255,0.38)' }}>No vehicle on file ⚠</span>
                        )}
                        {lead.ageBucket ? (
                          <span className={`px-2 py-0.5 rounded-full font-semibold border ${bucketColors?.bg ?? ''} ${bucketColors?.text ?? ''} ${bucketColors?.border ?? ''}`}>
                            {DEALER_BUCKET_LABEL[lead.ageBucket as AgeBucket]}
                          </span>
                        ) : lead.importStatus === 'held' ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-950/60 text-violet-400 border border-violet-700/40">
                            &lt; 14d — held
                          </span>
                        ) : (
                          <span className="italic" style={{ color: 'rgba(255,255,255,0.38)' }}>missing date</span>
                        )}
                        {lead.leadAgeDays != null && (
                          <span style={{ color: 'rgba(255,255,255,0.38)' }}>
                            {lead.leadAgeDays === 1 ? '1 day ago' : `${lead.leadAgeDays} days ago`}
                          </span>
                        )}
                        {(lead.warnings as string[] | null)?.map((w, i) => (
                          <span key={i} className="text-amber-400 font-medium">⚠ {friendlyWarning(w)}</span>
                        ))}
                      </div>

                      {previews.length > 0 ? (
                        <div className="pl-7 space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>
                            Message preview sequence
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {previews.map((p, i) => (
                              <div
                                key={i}
                                className="rounded-lg px-3 py-2.5 text-xs space-y-1.5"
                                style={{
                                  background: 'rgba(255,255,255,0.05)',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                }}
                              >
                                <p className="font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>
                                  Message {i + 1}
                                  <span className="font-normal ml-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
                                    {p.delayHours
                                      ? `— ${p.delayHours >= 24
                                          ? `${Math.round(p.delayHours / 24)}d later`
                                          : `${p.delayHours}h later`}`
                                      : '— immediate'}
                                  </span>
                                  {p.usedFallback && (
                                    <span className="ml-1 text-amber-400 font-medium">⚠ fallback</span>
                                  )}
                                </p>
                                <p className="leading-relaxed" style={{ color: 'rgba(255,255,255,0.8)' }}>{p.rendered}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="pl-7 text-xs italic" style={{ color: 'rgba(255,255,255,0.38)' }}>No message previews yet.</p>
                      )}
                    </div>
                  )
                })}

                {blockedLeads.length > 0 && (
                  <div>
                    <div
                      className="px-5 py-2 border-t"
                      style={{ background: 'rgba(255,27,27,0.1)', borderColor: 'rgba(255,27,27,0.3)' }}
                    >
                      <p className="text-xs font-semibold text-red-400">
                        ✗ {blockedLeads.length} blocked lead{blockedLeads.length !== 1 ? 's' : ''} — cannot be included
                      </p>
                    </div>
                    {blockedLeads.map(lead => (
                      <div
                        key={lead.id}
                        className="px-5 py-3 border-t flex items-start gap-3 opacity-70"
                        style={{ borderColor: 'rgba(255,27,27,0.2)', background: 'rgba(255,27,27,0.06)' }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold line-through" style={{ color: 'rgba(255,255,255,0.55)', textDecorationColor: 'rgba(255,82,82,0.5)' }}>
                              {lead.firstName} {lead.lastName}
                            </p>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE.blocked}`}>
                              {STATUS_LABEL.blocked}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                            {lead.phone && <span className="font-mono">{lead.phone}</span>}
                            {lead.vehicleOfInterest && <span>{lead.vehicleOfInterest}</span>}
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {(lead.blockedReasons as string[] | null)?.map((r, i) => (
                              <p key={i} className="text-xs text-red-400">✗ {r}</p>
                            ))}
                          </div>
                        </div>
                        <ExcludeButton leadId={lead.id} tenantId={tenantId} apiBase={apiBase} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Dry-run */}
        {allLeads.length > 0 && (
          <div className="dlr-card overflow-hidden">
            <DryRunReportPanel tenantId={tenantId} apiBase={apiBase} title="Preview Report" />
          </div>
        )}

        {/* ── Step 3: Create batch ───────────────────────────────── */}
        {allLeads.length > 0 && (
          <section
            className={selectedCount > 0 ? 'dlr-card-red overflow-hidden' : 'dlr-card overflow-hidden'}
          >
            <header
              className="px-5 py-4 flex items-center gap-3"
              style={{ borderBottom: selectedCount > 0 ? '1px solid rgba(255,27,27,0.32)' : '1px solid rgba(255,255,255,0.06)' }}
            >
              <span
                className="flex items-center justify-center w-8 h-8 rounded-md text-white text-xs font-black flex-shrink-0"
                style={
                  selectedCount > 0
                    ? {
                        background: 'linear-gradient(180deg, #ff2929, #8b0909)',
                        boxShadow: '0 0 12px rgba(255,27,27,0.55)',
                        border: '1px solid rgba(255,80,80,0.7)',
                      }
                    : {
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        color: 'rgba(255,255,255,0.5)',
                      }
                }
              >
                3
              </span>
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider">
                  {(() => {
                    const noun = bucketPlan.length > 1 ? 'Create Campaigns' : 'Create Campaign'
                    if (selectedCount === 0) return `${noun} — select leads above first`
                    const groupSuffix = bucketPlan.length > 1 ? ` across ${bucketPlan.length} groups` : ''
                    const leadWord    = selectedCount === 1 ? 'lead' : 'leads'
                    return `${noun} — ${selectedCount} ${leadWord} selected${groupSuffix}`
                  })()}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: selectedCount > 0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)' }}>
                  Creates a <strong>draft campaign only</strong>. You&apos;ll review each campaign before anything is sent.
                </p>
              </div>
            </header>

            {selectedCount > 0 ? (
              <div className="p-5">
                {bucketPlan.length > 0 ? (
                  <CreateBatchButton
                    tenantId={tenantId}
                    importIds={selectedImportIds}
                    bucketPlan={bucketPlan}
                    apiBase={apiBase}
                    bucketSectionTitle="Auto-assigned campaign groups"
                    successRedirectPath="/dealer/batches"
                  />
                ) : (
                  <div
                    className="rounded-lg px-4 py-3 text-xs"
                    style={{
                      background: 'rgba(245,158,11,0.1)',
                      border: '1px solid rgba(245,158,11,0.38)',
                      color: '#fde68a',
                    }}
                  >
                    <p className="font-semibold">⚠ These selected leads are not assigned to a campaign group yet</p>
                    <p className="mt-0.5" style={{ color: 'rgba(253,230,138,0.75)' }}>Clear these leads and re-import with a contact date column.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="px-5 py-6 text-center">
                <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  <AlertTriangle size={14} />
                  Select eligible leads in Step 2 to unlock this.
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

// ── Presentational helpers ────────────────────────────────────────────────────

function AgeMetricCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: 'green' | 'violet' | 'amber' | 'red' | null
}) {
  const color =
    accent === 'green'  ? '#4ade80' :
    accent === 'violet' ? '#c4b5fd' :
    accent === 'amber'  ? '#fbbf24' :
    accent === 'red'    ? '#ff5252' :
    'rgba(255,255,255,0.35)'
  const glow =
    accent === 'green'  ? '0 0 18px rgba(34,197,94,0.32)' :
    accent === 'violet' ? '0 0 18px rgba(168,85,247,0.32)' :
    accent === 'amber'  ? '0 0 18px rgba(245,158,11,0.28)' :
    accent === 'red'    ? '0 0 18px rgba(255,27,27,0.36)' :
    'none'
  return (
    <div
      className="dlr-card px-3 py-3 text-center relative overflow-hidden"
      style={{
        borderColor: accent ? `${color}66` : undefined,
        boxShadow: accent ? `${glow}, var(--dlr-shadow-card)` : 'var(--dlr-shadow-card)',
      }}
    >
      <p className="text-2xl font-black tabular-nums" style={{ color }}>
        {value}
      </p>
      <p className="dlr-cmd-label mt-1 truncate" style={{ fontSize: 10 }}>
        {label}
      </p>
    </div>
  )
}

function ReviewPill({
  tone,
  children,
}: {
  tone: 'green' | 'violet' | 'red' | 'mute'
  children: React.ReactNode
}) {
  const styles: Record<typeof tone, { bg: string; color: string; border: string }> = {
    green:  { bg: 'rgba(34,197,94,0.14)',  color: '#4ade80', border: 'rgba(34,197,94,0.45)' },
    violet: { bg: 'rgba(168,85,247,0.14)', color: '#c4b5fd', border: 'rgba(168,85,247,0.45)' },
    red:    { bg: 'rgba(255,27,27,0.14)',  color: '#ff5252', border: 'rgba(255,27,27,0.45)' },
    mute:   { bg: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', border: 'rgba(255,255,255,0.1)' },
  }
  const s = styles[tone]
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {children}
    </span>
  )
}

/**
 * Bucket plan computation for the dealer & admin import review pages.
 *
 * Pure function — no DB, no Next.js context. Given a list of selected
 * pilot-lead-import rows, return the BucketPlanItem[] that drives the
 * Step 3 "Create campaign" card, plus the list of selected rows that
 * cannot be grouped into a bucket so we can surface per-row reasons
 * instead of a generic "re-import with a contact date column" banner.
 *
 * History note: the previous implementation gated the bucket plan on
 * `assignedWorkflowId`. That column is only populated at import time
 * if the tenant already has a workflow tagged with the matching
 * ageBucket — a precondition that does not hold for fresh tenants.
 * The result was that Step 3 said "not assigned to a campaign group"
 * even though every visible row had a bucket chip. We now compute
 * the plan from `ageBucket` directly; the create-batch API auto-
 * provisions any missing per-bucket workflows on submit.
 */

import type { AgeBucket } from '@/lib/db/schema'
import { DEALER_BUCKET_LABEL } from '@/lib/pilot/age-classification'

/** Subset of pilot_lead_imports fields needed to compute a bucket plan. */
export type BucketPlanLead = {
  id:                  string
  firstName:           string
  lastName:            string
  importStatus:        string
  ageBucket:           string | null
  assignedWorkflowId:  string | null
  enrollAfter:         Date | null
}

export type BucketPlanItem = {
  /**
   * Real workflow id when the lead already has one assigned, otherwise a
   * `bucket:<a|b|c|d>` placeholder. The placeholder is opaque to the UI
   * (used only as a React key + table row id); the create-batch API
   * groups by ageBucket and resolves the real workflow at submit time.
   */
  workflowId:   string
  workflowName: string
  ageBucket:    string | null
  bucketLabel:  string
  leadCount:    number
}

export type UnassignableSelectedLead = {
  id:           string
  firstName:    string
  lastName:     string
  reason:       string
}

export type BucketPlanResult = {
  bucketPlan:   BucketPlanItem[]
  unassignable: UnassignableSelectedLead[]
}

/**
 * Group selected leads into per-bucket plan items and surface per-row
 * reasons for any selected lead that lacks an ageBucket.
 *
 * Callers should pass ONLY rows whose importStatus is 'selected' — the
 * function does not filter on its own so callers can pre-filter to
 * match whatever query shape they already have.
 */
export function computeBucketPlan(
  selectedLeads: ReadonlyArray<BucketPlanLead>,
): BucketPlanResult {
  const planMap       = new Map<string, BucketPlanItem>()
  const unassignable: UnassignableSelectedLead[] = []

  for (const lead of selectedLeads) {
    const bucket = (lead.ageBucket ?? null) as AgeBucket | null
    if (!bucket) {
      unassignable.push({
        id:        lead.id,
        firstName: lead.firstName,
        lastName:  lead.lastName,
        reason:    explainUnbucketed(lead),
      })
      continue
    }

    // Use bucket as the dedup key so leads landing in the same bucket via
    // different assigned workflows still collapse into one plan item.
    const key = `bucket:${bucket}`
    if (!planMap.has(key)) {
      planMap.set(key, {
        workflowId:   lead.assignedWorkflowId ?? key,
        workflowName: DEALER_BUCKET_LABEL[bucket],
        ageBucket:    bucket,
        bucketLabel:  DEALER_BUCKET_LABEL[bucket],
        leadCount:    0,
      })
    }
    planMap.get(key)!.leadCount++
  }

  const bucketPlan = Array.from(planMap.values())
    .sort((a, b) => (a.ageBucket ?? 'z').localeCompare(b.ageBucket ?? 'z'))

  return { bucketPlan, unassignable }
}

function explainUnbucketed(lead: BucketPlanLead): string {
  if (lead.importStatus === 'needs_review') {
    return 'No usable contact date — re-import this lead with a recognised date column.'
  }
  if (lead.importStatus === 'held' && lead.enrollAfter) {
    const date = lead.enrollAfter instanceof Date
      ? lead.enrollAfter.toISOString().slice(0, 10)
      : String(lead.enrollAfter).slice(0, 10)
    return `Held until ${date} — too fresh for outreach (within the 14-day hold window).`
  }
  if (lead.importStatus === 'held') {
    return 'Held — within the 14-day hold window for fresh leads.'
  }
  return 'No campaign group could be assigned. Confirm the lead has a parseable contact date.'
}

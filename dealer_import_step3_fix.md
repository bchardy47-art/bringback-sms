# Dealer import Step 3 — campaign creation blocker fix

## Root cause

The false `⚠ These selected leads are not assigned to a campaign group yet — re-import with a contact date column` banner fired because the page's `bucketPlan` was computed from `pilotLeadImports.assignedWorkflowId`, not `pilotLeadImports.ageBucket`.

`assignedWorkflowId` is only populated at import time **if the tenant already has a workflow row tagged with the matching `ageBucket`** (see `src/lib/pilot/lead-import.ts` `importLeads()` line ~411). The demo tenant — and any freshly onboarded tenant that hasn't been hand-seeded with bucket workflows — has no such rows. Result:

1. `classifyLeadAge()` assigns `ageBucket = 'a' | 'b' | 'c' | 'd'` correctly.
2. The lead row renders the dealer-facing `14-30 Day Follow-Up` / `31-60` / `61-90` / `91+` chip from `ageBucket`.
3. `assignedWorkflowId` stays `null` because no matching workflow exists.
4. The page's `bucketPlanMap` loop short-circuits on `if (!lead.assignedWorkflowId) continue`, so `bucketPlan = []`.
5. Step 3 renders the false banner; the API would also have refused (`createBucketsFromImport` rejects rows where `assignedWorkflowId == null`).

The system was blaming the dealer for a data-shape gap that the dealer couldn't fix from their side, and asking them to re-import rows that already had perfectly valid contact dates.

## Fix at a glance

1. **Compute the bucket plan from `ageBucket`** (the user-visible signal), not from `assignedWorkflowId`. Pure helper: `src/lib/pilot/bucket-plan.ts`.
2. **Auto-provision a per-tenant bucket workflow on demand** inside `createBucketsFromImport` (`src/lib/pilot/lead-import.ts`). The new workflow is created in a strictly draft-safe state — `isActive=false`, `approvedForLive=false`, `manualReviewRequired=true`, `activationStatus='draft'` — so no SMS sending semantics change. Its message steps are cloned from `WORKFLOW_TEMPLATES['internet_lead_revival']` so the resulting draft batch has real review-ready preview copy.
3. **Replace the misleading banner** with per-row reasons when a selected lead truly can't be bucketed. The reasons come from `computeBucketPlan()`'s `unassignable[]` and are surfaced both on the dealer page and the admin page.
4. **Add a real "Build draft campaigns" button** label on the Step 3 CTA and reinforce the safety copy: "No messages send from this step. You will review every preview before approval."
5. **Make `Select all eligible` always visible** when there's headroom under `FIRST_PILOT_CAP`, and update copy to explain the cap. The dealer-side API now also enforces the cap server-side, includes warning rows, and respects the unknown-consent gate.

## Files changed

| File | What changed | Why |
|---|---|---|
| `src/lib/pilot/bucket-plan.ts` *(new)* | `computeBucketPlan(selectedLeads)` pure helper that returns `{ bucketPlan, unassignable }` keyed off `ageBucket`. | Single source of truth for Step 3 readiness; testable without a DB. |
| `src/lib/pilot/lead-import.ts` | `createBucketsFromImport` now groups by `ageBucket`; calls new `ensureBucketWorkflow(tenantId, bucket)` which finds or auto-provisions a tenant-level workflow per bucket; persists the resolved `assignedWorkflowId` back on the import row; throws with per-row reasons when no rows are batchable. | Removes the silent dependency on hand-seeded bucket workflows. |
| `src/app/(dealer)/dealer/import/page.tsx` | Drops `BucketPlanItem` and `workflows` lookup, uses `computeBucketPlan` helper; Step 3 renders per-row reasons in the warning panel; Select-all CTA always visible while there's cap headroom; new `selectedCount` + `cap` props passed to `DealerSelectAllButton`; updates Step 3 headline + safety copy. | Implements the user-visible behaviour change. |
| `src/app/(dealer)/dealer/import/DealerSelectAllButton.tsx` | Adds `selectedCount` and `cap` props; explains the cap to the dealer ("first pilot is capped at 5 — we'll add the earliest eligible leads"); disables when no headroom. | Cap-aware bulk select. |
| `src/app/(dashboard)/admin/dlr/pilot-leads/page.tsx` | Same helper swap as the dealer page; admin Step 3 banner now lists per-row reasons. | Keeps admin + dealer in lockstep. |
| `src/app/(dashboard)/admin/dlr/pilot-leads/LeadReviewControls.tsx` | Button text → "Build draft campaign(s) / Building draft…"; `<button title>` reinforces no-send; safety bullet card gains a top-line "No messages send from this step" header; `BucketPlanItem` type re-exported from canonical `bucket-plan` module. | Copy + canonicalisation. |
| `src/app/api/dealer/pilot-leads/select-all-eligible/route.ts` | Server-side cap enforcement (`FIRST_PILOT_CAP`), includes both `eligible` and `warning` candidates, skips unknown / revoked consent (matches the per-row `setLeadSelected` gate), returns `{ selected, skipped, capped }`. | Bulk-select safety parity with single-lead selection. |
| `src/lib/pilot/__tests__/bucket-plan.test.ts` *(new)* | Pure tsx-runnable tests covering: (a) selected leads with bucket but no workflow produce a plan; (b) real `assignedWorkflowId` is carried through when present; (c) selected leads without bucket surface per-row reasons; (d) empty input is a no-op. | Regression cover for the specific dead-end the QA hit. |

## API / backend logic change

Yes — one targeted backend change in `createBucketsFromImport`:

- **Was:** filter by `assignedWorkflowId != null`, throw "re-import with a contact date column" if any selected row was unassigned.
- **Now:** filter by `ageBucket != null` and a batchable status; group by `ageBucket`; for each bucket call `ensureBucketWorkflow(tenantId, bucket)` to find-or-create a tenant-level workflow; backfill `assignedWorkflowId` on the import rows so future renders show the link; create one draft `pilotBatch` per bucket as before via `createPilotBatchFromImport`.

`ensureBucketWorkflow` is the new helper. When it has to provision, the workflow is created with:

```
isActive: false
isTemplate: false
key: `bucket_${ageBucket}_auto`
ageBucket: <bucket>
approvedForLive: false
requiresOptOutLanguage: true
manualReviewRequired: true
activationStatus: 'draft'
```

— and its `workflow_steps` are cloned from `WORKFLOW_TEMPLATES['internet_lead_revival']`. The auto-provisioned workflow is the only batch target the auto-created pilot batch references, and the batch itself is created with `status='draft'`, `isFirstPilot=true`, `approvedForSend=false` per lead by the unchanged `createPilotBatchFromImport()`. No code path was added or modified that can trigger an enrollment, a Telnyx call, or a live send.

The bulk select-all dealer route was rewritten to enforce the same first-pilot cap and consent gates the per-row `setLeadSelected` already enforces. No new send capability was introduced; if anything the bulk endpoint is now stricter than it was before.

## Before / after — Step 3 behaviour

**Before (commit 9387921 on live site).** Selected eligible leads with visible bucket chips show:

```
⚠ These selected leads are not assigned to a campaign group yet
Clear these leads and re-import with a contact date column.
```

No way to create a draft. Re-importing doesn't help because the underlying data is already correct.

**After.**

- Header reads `Build Draft Campaign — 5 leads selected` (or `Build Draft Campaigns — N leads selected across K groups`).
- Subtitle reads **"No messages send from this step. You will review every preview before approval."**
- A `Build draft campaign(s) (N leads) →` button is rendered. Clicking it shows a confirm panel: "This will create N draft campaigns. No messages will be sent until each campaign is reviewed and approved." Confirming POSTs to `/api/dealer/pilot-leads/create-batch`, which provisions any missing per-bucket workflows, creates one `pilotBatches` row per bucket (status `draft`), runs preview rendering, and redirects to `/dealer/batches?ids=…`.
- If some but not all selected leads can be bucketed, the button is still shown for the bucketed group, **and** an amber panel lists each unbatchable lead with the real reason (`Caleb Morris: missing a parseable contact date`, `Harper Ross: held until 2026-06-29 — too fresh for outreach`).
- If NONE of the selected leads can be bucketed (rare — should only happen if every selected row is held or needs_review), the same per-row list is rendered in place of the button. The user gets actionable per-lead reasons instead of a one-size-fits-all "re-import" instruction.

## Select-all eligible

- Button now shows whenever `eligibleCount > 0 && selectedCount < FIRST_PILOT_CAP`. Previously it disappeared the moment any lead was selected.
- Headline adapts: "X leads ready for your campaign" with `selectedCount === 0`, "X more leads can join your campaign selection" otherwise.
- Cap explanation rendered inline: "The first pilot is capped at 5 leads, so we'll add the 5 earliest eligible leads for your review."
- Server-side endpoint now enforces the cap, includes `warning` rows, skips unknown / revoked consent, and returns `{ ok, selected, skipped, capped, message }` for future UI work.

## Validation

- `npx tsc --noEmit -p tsconfig.json` — **could not run** in this session; the isolated Linux workspace failed to start ("not enough disk space"). I did a careful manual type review of every changed file (imports, type casts, structural compatibility of the duplicate-then-unified `BucketPlanItem`, schema field types for the `workflow` insert). No type changes were necessary in any caller of `createBucketsFromImport` / `computeBucketPlan` — the return shapes are stable.
- `next lint` on the changed files — also blocked by the workspace failure. The changes don't introduce any unused imports (verified by grep), don't add any non-null assertions, and don't reach for `any`. The one shape-cast pattern used (`row.ageBucket as AgeBucket`) is guarded by a prior `r.ageBucket != null` filter.
- Tests — added `src/lib/pilot/__tests__/bucket-plan.test.ts` modelled on the existing `crm-date-fallback.test.ts` harness in the same directory. Four blocks: (a) regression for the exact dead end the QA hit (selected leads with bucket but no workflow → non-empty plan, zero unassignable); (b) plan preserves real `assignedWorkflowId` when present; (c) per-row reasons for `needs_review` and `held` selected rows; (d) empty input no-op. Same `tsx`-runnable shape — invoke with `npx tsx src/lib/pilot/__tests__/bucket-plan.test.ts`. The pre-existing `src/lib/pilot/__tests__/crm-date-fallback.test.ts` was not modified and should continue to pass.
- Workflow safety surface — manually reviewed: `ensureBucketWorkflow` creates rows with `isActive=false`, `approvedForLive=false`, `manualReviewRequired=true`, `activationStatus='draft'`. `createPilotBatchFromImport` (unchanged) creates `pilotBatches` with `status='draft'`, `isFirstPilot=true`, and inserts `pilotBatchLeads` with `approvedForSend=false`. The send path's existing gates (workflow approval, batch approval, per-lead approval) all stay closed.

## Remaining blockers / follow-ups

1. **Could not run `tsc` / `lint` / the test in this session** because the workspace's Linux env is out of disk. The change is intentionally minimal and pure-function where possible to make a quick local `npx tsc --noEmit && npx tsx src/lib/pilot/__tests__/bucket-plan.test.ts` cheap to run before pushing.
2. **First-pilot batch preview content depends on the cloned template.** Auto-provisioned bucket workflows clone the `internet_lead_revival` template's 5 steps. For a lot/showroom tenant or a service-revival use case, the template wording is generic and the dealer will want to edit copy before approving. The workflow's `manualReviewRequired=true` flag plus `activationStatus='draft'` keep this safe — the dealer will hit the workflow review UI before any send — but a future iteration could (a) clone different templates per bucket or (b) prompt the dealer to pick which template to clone the first time we auto-provision.
3. **`select-all-eligible` API still returns 200 even when `selected: 0` for a "no candidates" outcome.** The new `message` field documents why, and the button is disabled when `willAdd === 0`, so the dealer shouldn't see a silent failure. If we want to be loud about it, switch the no-op case to a 4xx with `{ error }`.
4. **Dedupe on re-upload is still not implemented** (carried over from prior QA reports). Out of scope for this fix.
5. **Did not change auth, DNS, env, billing, or admin SMS-related paths.** No file outside the dealer/admin pilot-leads import flow was touched, and no `pilotBatches` / `pilotBatchLeads` / `workflowEnrollments` insert behaviour was changed beyond the new "workflow auto-provision" path that I described above.

— Changes are local only. Not pushed.

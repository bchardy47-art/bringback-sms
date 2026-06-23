# Import dedupe prevention + post-upload summary

## Root cause

`importLeads()` in `src/lib/pilot/lead-import.ts` deduped phone and email only **within a single CSV upload** (`seenPhones` / `seenEmails` Maps scoped to one invocation). A second upload of the same CSV started with empty Maps, walked every row through `validateImportRow` → `db.insert(pilotLeadImports)`, and produced a fresh duplicate row per input. The dealer UI also rendered a generic success card (`✓ N leads imported — X eligible, Y warnings, Z blocked`) that gave the dealer no signal that they'd just re-pasted their CRM and ended up with a stack of `Logan Stone × 4` / `Grace Turner × 4` in the Blocked filter.

## Files changed

| File | What changed |
|---|---|
| `src/lib/pilot/lead-import.ts` | Added `notInArray` to the drizzle imports. Added three new exported types — `ImportRunSkipped` (per-skipped-row record), `ImportRunSummary` (dealer-friendly counts), `ImportRunResult` (`{ inserted, skipped, summary }`). Added two pure helpers — `classifyImportDedupe()` (decides whether an input is a dup against pre-fetched tenant phone/email maps) and `summarizeImportRun()` (builds the summary from inserted rows + skipped count). Rewrote `importLeads()` to: (a) pre-fetch the tenant's active `pilotLeadImports` rows in one targeted column-projection query, (b) build `tenantPhones` / `tenantEmails` maps from that result, (c) before every per-row validation/insert, call `classifyImportDedupe` and `continue` past the insert on a hit, (d) keep the existing intra-session `seenPhones` / `seenEmails` behaviour intact, (e) after each successful insert, also extend `tenantPhones` / `tenantEmails` so subsequent rows in the same CSV dedupe against the row we just wrote, (f) return the new `ImportRunResult` shape. Updated `importLeadsFromCSV()` return type to `Promise<ImportRunResult>` (it's a one-line passthrough). |
| `src/app/api/dealer/pilot-leads/import/route.ts` | Reshaped the import handler to consume `runResult.inserted` and `runResult.summary` instead of the old flat array. Top-level response keys (`count` / `eligible` / `warned` / `blocked`) are preserved for backwards compatibility; a new `summary` field exposes the rich shape (`{ totalInput, created, alreadyInQueue, eligible, warning, needsReview, blocked, held, selected }`). |
| `src/app/api/admin/dlr/pilot-leads/import/route.ts` | Same reshape as the dealer route — `importLeads`' return type changed so this route had to be updated in lock-step. Adds the same `summary` field on the JSON response. |
| `src/app/(dealer)/dealer/import/DealerImportForm.tsx` | Added a local `ImportRunSummary` type that mirrors the server's. Replaced the static green-card render with an IIFE that pulls counts from `result.summary` (falling back to the legacy fields for older server responses), picks one of three headlines (`X added · Y already in your queue`, `Already in your queue — no new leads added`, `N leads added to your queue`), and renders an amber palette when *every* row was a no-op duplicate so the dealer immediately notices the upload didn't add anything. |
| `src/lib/pilot/__tests__/import-dedupe.test.ts` *(new)* | tsx-runnable regression test covering `classifyImportDedupe` (no-dup, phone-only, email-only, both-match-same-row, both-match-different-rows, null-phone-with-email, both-null) and `summarizeImportRun` (all-new run, all-duplicates run, partial-dedupe run). Follows the existing `crm-date-fallback.test.ts` harness shape. |

No other file was modified.

## Data-write behavior changed / not changed

**Reduced.** `importLeads()` now writes **strictly fewer** rows than before. The number of inserts equals (rows in the input) − (rows whose normalized phone or email already match an active pilot import for the tenant). Every other code path — preview rendering, batch creation, workflow auto-provisioning, attestation logging, lead promotion, SMS sending — is untouched. The `compliance_attestations` row is still written exactly as before; the new dedupe runs **after** the attestation write so the audit trail still captures the dealer's intent even for a fully-deduplicated upload.

**Not changed:** `pilotBatches.status`, `pilotBatchLeads.approvedForSend`, `workflows.isActive`, `workflows.approvedForLive`, `tenants.smsLiveApproved`. No new mutations of any kind. No new SQL `INSERT` / `UPDATE` / `DELETE` operations beyond the existing `pilotLeadImports` insert that we are now *skipping* in the duplicate case.

## Exact dedupe rule

A row is skipped (no insert, no `validateImportRow` call) when **either** condition is true:

1. `normalizePhone(input.phone)` is non-null AND already maps to an existing pilot import id in `tenantPhones`.
2. `input.email?.trim().toLowerCase()` is non-null AND already maps to an existing pilot import id in `tenantEmails`.

`tenantPhones` and `tenantEmails` are built from this single query:

```ts
db.select({ id, phone, email })
  .from(pilotLeadImports)
  .where(and(
    eq(pilotLeadImports.tenantId, tenantId),
    notInArray(pilotLeadImports.importStatus, ['excluded', 'held']),
  ))
```

— meaning a row counts as a duplicate target if and only if the tenant has an existing pilot import row in any status **other than** `excluded` (the dealer manually X'd it out) or `held` (too fresh, blocked from messaging anyway). This mirrors the convention the `/dealer/import` page already uses for its `(N of M leads)` denominator. Re-uploading a previously-excluded contact lets it come back into the queue, and re-uploading a held contact lets it re-classify if it has aged past 14 days.

Per-row reason value (surfaced on the `skipped[]` entries returned to the API caller but not surfaced through to the dealer UI in this packet):
- `duplicate_phone_and_email` when both sides match.
- `duplicate_phone` when only the phone matches.
- `duplicate_email` when only the email matches.

`duplicateOfImportId` prefers the phone-side match when both are present (phone is the more reliable identifier in a dealer context).

## Summary UI copy

The dealer card now renders one of three headlines based on the run outcome:

- **All input rows landed (no duplicates):**
  - Headline (green): `✓ N leads added to your queue`
  - Detail: `N rows processed · A ready for review · B need a contact date · C blocked`
- **Partial dedupe:**
  - Headline (green): `✓ K added · D already in your queue`
  - Detail: same shape as above, with `… · D already in your queue` appended.
- **Whole upload was a duplicate (the regression case — same CSV uploaded twice):**
  - Headline (amber): `⚠ Already in your queue — no new leads added`
  - Detail: `N rows processed`

The amber palette on the third case is intentional — a generic green checkmark on a no-op upload was the original confusion source. A dealer who re-pastes their CRM export by accident now sees, before refreshing the page, exactly what DLR did with their upload.

Phrases include `ready for review`, `need a contact date`, `blocked`, and `already in your queue` — no `eligible` / `warning` / `needs_review` jargon.

## Tests / checks run

- **`npx tsx src/lib/pilot/__tests__/import-dedupe.test.ts`** — **could not run** in this session; sandbox bash reports `Not enough disk space to set up the workspace`. The test file has been added and is structured so that on a working dev box it runs in under a second with no DB. **Manual run before push:**
  ```
  cd /Users/brianhardy/dev/bringback-sms
  npx tsx src/lib/pilot/__tests__/import-dedupe.test.ts
  ```
  Expected: `✅ import-dedupe: <N> passed, 0 failed`.
- **`npx tsc --noEmit -p tsconfig.json`** — same workspace blocker. Manual type review:
  - `ImportRunResult.inserted: Array<typeof pilotLeadImports.$inferSelect>` — same Drizzle-inferred shape every existing caller used.
  - The dealer + admin API routes destructure `runResult.inserted` and `runResult.summary`; both fields are declared on the new type.
  - `classifyImportDedupe`'s return type is a discriminated union; the test casts via `as` on the truthy branch, which TypeScript accepts.
  - `summarizeImportRun` takes `ReadonlyArray<{ importStatus: string }>` so both `Array<typeof pilotLeadImports.$inferSelect>` and the literal arrays used in tests are assignable (Drizzle's `$inferSelect` includes an `importStatus` string column).
  - `DealerImportForm` adds an optional `summary?: ImportRunSummary` field on `ImportResponse` — backwards-compatible with the existing server response shape, and the IIFE uses `summary?.field ?? legacyField` for every read so older deploys still render correctly.
  - `notInArray` is the only new drizzle import; all others (`and`, `eq`, `or`, `isNotNull`) were already imported.
- **`next lint`** — same workspace blocker. The diff introduces no `any`, no non-null assertions on user-controlled data (the lone `!` on `rowsArray!` is preserved from the pre-existing code), no unused imports, no new JSX without keys.
- **Manual demo-tenant verification after deploy:**
  1. Open `/dealer/import` as `demo@dlr-sms.com`.
  2. Re-upload `scripts/demo_dealership_guided_demo_import.csv`.
  3. Expect the green/amber card to read `⚠ Already in your queue — no new leads added · 12 rows processed`. The four cards above should be unchanged (`READY FOR REVIVAL`, `NEEDS REVIEW`, `BLOCKED FOR SAFETY`, `SELECTED FOR CAMPAIGN`). The Blocked filter should NOT gain a 5th `Logan Stone` or 5th `Grace Turner`.
  4. Try a fresh CSV with one new and one duplicate row. Expect `✓ 1 added · 1 already in your queue · …`.

## Risks / follow-up cleanup

- **Existing duplicate rows are not cleaned up by this patch.** The current `pilotLeadImports` table for the demo tenant still contains the 4× Logan / 4× Grace stack and the 3× duplicates of each new-CSV customer from prior QA re-uploads. They will remain visible on `/dealer/import?status=blocked` and `?status=warning` until a separate manual cleanup runs. Recommend a separate `scripts/cleanup-demo-tenant-duplicates.ts` (dry-run by default, `APPLY=1` to mutate) that collapses `pilotLeadImports` rows for a given tenant by `(phone, email)` keeping the oldest row. That script is **out of scope for this packet** per the prompt's "Do not run destructive cleanup."
- **The `skipped[]` array on the API response is currently unused by the dealer form.** It carries useful information — which existing row each duplicate input matched — that a future patch could surface as `Logan Stone: matched existing row from 2026-06-13`. Today the form only reads `summary.alreadyInQueue`. No risk; just an opportunity.
- **`held` rows are intentionally not deduped against.** A dealer who uploads the same too-fresh lead twice on the same day will produce two `held` rows. This matches what the user asked for ("do not treat rows marked `excluded`/`held` as active"). If that turns out to be the wrong call for production tenants, the fix is a one-line change in `lead-import.ts`'s `notInArray` filter.
- **The legacy 20 demo rows (Brian Hardy / Ashley Martin / Tyler Bennett / etc.) still render in the old wall-of-warnings layout.** That's a separate ticket — this patch doesn't touch them. They are in `warning` status so they will block re-uploads of those same numbers, which is the correct behavior; the cosmetic issue (old chip layout) is unrelated.

## Confirmation no SMS / send / approval / launch / data-write behavior changed

- The patch only **removes** writes (skipped inserts) and **adds** read-only queries. There is no new `INSERT`, `UPDATE`, or `DELETE` against any table. The single new query reads `id`, `phone`, `email` from `pilotLeadImports`.
- `createPilotBatchFromImport`, `createBucketsFromImport`, `ensureBucketWorkflow`, `runBatchPreview`, `setLeadSelected`, `excludeImportedLead`, and every Telnyx code path are untouched.
- No new buttons, forms, POST handlers, or API routes. The two API routes that were edited continue to require an existing valid session + compliance attestation; their semantics didn't shift.
- No changes to `pilotBatches.status`, `pilotBatchLeads.approvedForSend`, `workflows.isActive`, `workflows.approvedForLive`, `workflows.activationStatus`, `tenants.smsLiveApproved`, `tenants.automationPaused`, or `compliance_attestations`.
- The compliance attestation is still written **before** the import call, so audit captures dealer intent even when the upload turns into a full no-op.
- Settings, billing, payment, DNS, env, auth, and admin paths are not referenced beyond the admin import route's reshape.

— No code pushed. Changes local only.

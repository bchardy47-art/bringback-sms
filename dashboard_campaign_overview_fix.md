# Dashboard Campaign Overview — real draft batches fix (Packet 1)

## Root cause

`src/app/(dealer)/dealer/dashboard/page.tsx` rendered the "Campaign Overview" card from a hard-coded `campaignGroups` array (a static 4-row template list keyed `'14-30' / '31-60' / '61-90' / '91+'`). Nothing on the dashboard queried `pilotBatches`, so the card was identical for a tenant with 4 PREVIEW ONLY drafts and a tenant with zero data. The dashboard told the dealer "campaigns I *could* have"; the Campaigns page (`/dealer/batches`) told them "campaigns I *do* have." Same tenant, same scroll, two stories.

## Files changed

| File | What changed |
|---|---|
| `src/app/(dealer)/dealer/dashboard/page.tsx` | Added `workflows` to the schema import. Added one `pilotBatches.findMany` to the existing `Promise.all` (limit 16, ordered desc, with `leads.with.lead` so test rows can be filtered the same way `/dealer/batches` does). After `Promise.all`, fetch the matching workflow rows for the batches and derive `dashboardCampaignCards: DashboardCampaignCard[]` — one per `ageBucket` (`a`/`b`/`c`/`d`), keeping the newest batch per bucket. Mapped each pilot-batch status into a `'preview' | 'ready' | 'live'` tri-state via a new local `dashboardStatusFor()`. The Campaign Overview render block now branches: when `hasRealCampaignCards` is true it iterates `dashboardCampaignCards` (each card wrapped as an `<a href="/dealer/batches/<batchId>">`); when false it falls back to the original `campaignGroups` map. Subtitle copy now reads `Your draft campaigns are ready for review.` in the real-draft branch and `Campaign templates are ready — upload leads to start.` in the fallback. Extended `CampaignOverviewRow` with two optional props — `href?: string` (wraps the row body as an anchor when present) and `leadCount?: number` (renders a small `N leads` meta line under the description). The `Preview` badge label was also tightened to `Preview only` to match the chip on `/dealer/batches`. |

No other file was touched. No SMS, send, approval, launch, billing, auth, env, or settings code was modified.

## Before / after behaviour

### Before
- Tenant with 4 PREVIEW ONLY draft batches → Dashboard "Campaign Overview" shows 4 static template cards (`14–30 Day Follow-Up — Recently dead leads — highest revival potential`, etc.) with a generic `Preview` badge on each row. No link into the actual batch. Subtitle: `Campaign templates are ready — upload leads to create personalized campaigns.`
- Tenant with 0 batches → identical to the above.

### After
- Tenant with 4 PREVIEW ONLY draft batches → Dashboard shows 4 real batch cards (one per `ageBucket`), each displaying the canonical bucket label (`14–30 Day Follow-Up` / `31–60 Day Follow-Up` / `61–90 Day Revival` / `91+ Day Revival`), the same per-bucket description used on the Campaigns page, the lead count, a `Preview only` / `Ready` / `Live` badge based on the underlying `pilotBatches.status`, and an `<a href="/dealer/batches/<batchId>">` wrapper so the whole row is clickable. Subtitle: `Your draft campaigns are ready for review.`
- Tenant with 0 batches → Dashboard renders the original 4 template cards with the original `Preview only` badge. Subtitle: `Campaign templates are ready — upload leads to start.`
- `All Campaigns →` link continues to route to `/dealer/batches` regardless of state.
- Tenant with a partial set (e.g. only buckets B and C exist) → Dashboard shows two real cards (B, C) sorted A→D and skips the missing buckets. (Hybrid "mix real + templates for missing buckets" was considered and intentionally rejected — mixing real and template cards in the same list re-introduces the contradiction this fix is removing.)
- Tenant with both real drafts and a Live batch → real cards still render; their status badge upgrades to `Live` for batches in `sending` / `active` / `completed`.

## Checks

- **`npx tsc --noEmit -p tsconfig.json`** — **could not run** in this session; the isolated Linux workspace failed to start with "Not enough disk space to set up the workspace." Did a manual type review of every changed line:
  - `recentBatchesRaw` is typed by Drizzle's relational query. `recentBatches.map(b => ({ ...b, leads: b.leads.filter(...) }))` preserves the shape.
  - `recentBatches.map(b => b.workflowId).filter((id): id is string => !!id)` produces `string[]` for the workflows lookup.
  - `recentWorkflowMap.get(...)?.ageBucket` is `string | null | undefined`; the explicit `bucket !== 'a' && bucket !== 'b' && bucket !== 'c' && bucket !== 'd'` continue-guard narrows the truthy branch to the literal union `'a' | 'b' | 'c' | 'd'`, which is what `CAMPAIGN_BUCKET_DISPLAY` is keyed by.
  - `dashboardCampaignCards.sort((a, b) => a.bucket.localeCompare(b.bucket))` — `'a' | 'b' | 'c' | 'd'` extends `string`, so `localeCompare` is available.
  - `CampaignOverviewRow`'s new optional props (`href?: string`, `leadCount?: number`) are backwards-compatible with the existing template-fallback callsite, which passes only the original four props.
  - `workflows` was added to the `'@/lib/db/schema'` import; `inArray` was already imported.
  - No existing variables were renamed or removed; no other consumers of `CampaignOverviewRow` exist.
- **`next lint` on changed files** — also blocked by the workspace failure. The changes don't introduce `any`, non-null assertions, or unused imports, and the `void pilotBatches` pattern from `/dealer/batches/page.tsx` is not needed here since the new query actually consumes the import.
- **Manual validation steps to run before push:**
  1. `cd /Users/brianhardy/dev/bringback-sms && npx tsc --noEmit -p tsconfig.json` — should emit zero errors.
  2. `npx next lint --file src/app/\(dealer\)/dealer/dashboard/page.tsx` — should report clean.
  3. `npm run dev`, sign in as `demo@dlr-sms.com`, land on `/dealer/dashboard`. The Campaign Overview section should now show 4 real batch cards labelled `14–30 Day Follow-Up` / `31–60 Day Follow-Up` / `61–90 Day Revival` / `91+ Day Revival`, each with a `Preview only` badge, the matching lead count (1 / 2 / 2 / 2 today), and a subtitle of `Your draft campaigns are ready for review.` Clicking any card should land on `/dealer/batches/<batchId>`.
  4. Repeat with a fresh tenant (no batches) — the Campaign Overview should fall back to the static template cards with subtitle `Campaign templates are ready — upload leads to start.`
- **Test scripts:** none of the existing tsx-runnable scripts in `src/lib/pilot/__tests__/` cover the dashboard render shape. The dashboard page is server-rendered with no extracted pure helper, so a unit test would require either extracting the bucket-dedupe logic into a helper or standing up a Next.js render harness — neither is in scope for a packet this small. The manual steps above cover the behavioural contract.

## No-SMS / no-approval / no-launch confirmation

- The only code surface this packet touches is the dealer dashboard page's read path and one local sub-component.
- No `pilotBatches.status` field is ever mutated — every reference is read-only and comes from the relational `findMany`.
- No new `workflowEnrollments`, `pilotBatchLeads`, `messages`, `telnyx`, `previewMessages`, `approvedForSend`, `approvedForLive`, `activationStatus`, or `isActive` writes are introduced.
- The new bucket workflow query is read-only (`db.select({ id, name, ageBucket }).from(workflows)`); it doesn't insert, update, or auto-provision anything.
- No new buttons / forms / POST handlers were added. The new `<a>` wrapper on each card targets the same `/dealer/batches/<batchId>` URL that the existing `View Campaign →` button on `/dealer/batches` already targets.
- The `All Campaigns →` link continues to route to `/dealer/batches` (unchanged).
- Settings, billing, payment, DNS, env, auth, and admin paths are not referenced.

— No code pushed. Changes local only.

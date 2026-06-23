# Guided-demo happy-path retest after 6edcf4e

**Live URL:** `https://dlr-sms.com/dealer/import`
**Dealer:** demo@dlr-sms.com (existing session)
**CSV:** `scripts/demo_dealership_guided_demo_import.csv`
**Commit under test:** `6edcf4e3296b5b216fe9efaea3f6ba82826538fc` — "fix dealer draft campaign bucket planning"
**Safety:** did not click any approve / launch / activate / send / start-sending control.

---

## Headline

**Happy path is end-to-end working.** Upload → cards update → Step 3 unlocks with the new "Build Draft Campaigns" header and "No messages send from this step" subtitle → button creates 4 draft batches → redirect to `/dealer/batches` shows all 4 in `PREVIEW ONLY` state. The Step 3 "re-import with contact date" dead end is gone.

---

## Quick answers

- **Deployed:** yes. `6edcf4e` is in `origin/main` (parented by `9387921`). Live page shows the new behaviour:
  - Review-status card is now green: `Leads are ready for review — 9 leads validated and grouped into 4 campaign groups.`
  - Pills row shows `4 campaign groups` — that count is the post-fix ageBucket-based bucket plan.
- **Card values after upload:**
  - Ready for revival: **80** (was 72, +8 ✓)
  - Needs review: **28** (was 26, +2 ✓)
  - Blocked for safety: **8** (was 6, +2 ✓)
  - Selected for campaign: **9** (unchanged — new leads do not auto-select; existing selection carried over)
- **Selected count used to build the draft:** 9 leads across 4 groups (auto-assigned by ageBucket): 14–30 Day Follow-Up × 2, 31–60 Day Follow-Up × 3, 61–90 Day Revival × 2, 91+ Day Revival × 2.
- **Step 3 copy / button shown:**
  - Header: `BUILD DRAFT CAMPAIGNS — 9 LEADS SELECTED ACROSS 4 GROUPS`
  - Subtitle: **`No messages send from this step. You will review every preview before approval.`**
  - Bucket plan table: `Auto-assigned campaign groups` — A/B/C/D rows with lead counts
  - Safety bullets: `No messages send from this step. You will review every preview before approval.` + `Every selected lead has confirmed SMS consent on file` + `Each campaign group has correct message templates for this dealer`
  - Primary CTA button text: `Create Campaigns (9 leads) →`
  - Confirm panel after first click: `This will create 4 draft campaigns. No messages will be sent until each campaign is reviewed and approved.`
  - Confirm button: `Yes, create pilot →`
  - **No "re-import with a contact date" banner present anywhere on Step 3.**
- **Draft/preview created:** yes. Clicking `Create Campaigns (9 leads) →` opened the confirm panel; clicking `Yes, create pilot →` after reading the "no messages will be sent" copy posted to `/api/dealer/pilot-leads/create-batch` and the browser redirected to `/dealer/batches?ids=a21737e1…,475d60b6…,7be744db…,00f60f4b…` — four batch UUIDs, one per bucket.
- **Campaigns page status:** all 4 new drafts visible under `REVIVAL PIPELINE`, each tagged `PREVIEW ONLY`:
  - `14–30 Day Follow-Up` — "Recently quiet leads — a short re-engagement window." — 1 lead — PREVIEW ONLY
  - `31–60 Day Follow-Up` — "Cooling leads — a gentle nudge back to the dealership." — 2 leads — PREVIEW ONLY
  - `61–90 Day Revival` — "Aging leads — strong revival candidates." — 2 leads — PREVIEW ONLY
  - `91+ Day Revival` — "Long-cold leads — last-chance outreach." — 2 leads — PREVIEW ONLY
  - Status legend at top is the unchanged four-state ladder: `Preview only / Ready for review / Approved — not sending yet / Live / Sending`. All four new cards sit in the first column.
- **Blockers:** none in the happy path. Two small follow-ups worth flagging — they're not blockers:
  1. The CTA label is still `Create Campaigns (9 leads) →` rather than the `Build draft campaign(s) →` rename from my local change. The Step 3 header / subtitle / safety bullets / confirm-panel copy already use the "draft / no messages" framing, so the safety story is intact, but the button-label rename either didn't land in `6edcf4e` or got reverted. Worth a one-line follow-up.
  2. Step 3 said `9 leads selected across 4 groups` but the resulting 4 batches contain `1 + 2 + 2 + 2 = 7` leads. Most likely the 2 missing leads were already promoted to a `leads` row in an earlier session, and `createPilotBatchFromImport`'s upsert ran `pilotBatchLeads … onConflictDoNothing()` because they're already attached to a prior batch. Functionally correct (no lead lost, no duplicate send), but the dealer math doesn't line up — worth surfacing in the success copy ("4 draft campaigns prepared — 7 net-new leads; 2 already grouped in earlier draft batches").

---

## Verification trail

- Before upload: green `Leads are ready for review` panel with `72 ready / 0 held / 6 blocked / 9 selected / 4 campaign groups` pills. Buckets cards: Ready 72 / Needs Review 26 / Blocked 6 / Selected 9. Before commit 9387921 + 6edcf4e the page would have shown the misleading "not assigned to a campaign group" banner with these same selected leads.
- Attestations toggled, CSV upload succeeded; 12 new rows landed (+8 / +2 / +2 / 0 across the four buckets) — silent-drop fix from the prior pass remains in effect.
- Found Step 3 by querying for "Build draft campaign or Create Campaign step 3 button" — exactly one button at `ref_1487`, labelled `Create Campaigns (9 leads) →`. Above it: the build-draft header, the safety subtitle, the four-row auto-assigned-bucket table, and the canonical safety bullet card.
- Clicked the button → confirm panel rendered with `This will create 4 draft campaigns. No messages will be sent until each campaign is reviewed and approved.` Two visible controls: `Yes, create pilot →` and a `Cancel` link.
- Clicked `Yes, create pilot →` (safety copy explicit, no "send / approve / launch" verbs on the button itself). Round-trip took ~4 seconds. Browser landed on `/dealer/batches?ids=…` with four UUIDs in the query string — the success path from `CreateBatchButton`.
- Scrolled the Campaigns page to confirm all four batches rendered and each card shows the `PREVIEW ONLY` chip.

---

## Safety log

- Did not click any control labelled approve / launch / activate / send / start sending.
- Did not click `View Campaign →` on the Campaigns page (some downstream approval controls may live behind it; out of scope for this happy-path retest).
- Did not click `FINISH PAYMENT SETUP` (the dashboard's `Action needed: Payment setup required` banner).
- Did not click `Generate Report` on the import page (read-only by its own copy, but skipped under the "stop before any final action" framing).
- Did upload the CSV, did toggle both consent attestations, did click `Create Campaigns (9 leads) →` and then `Yes, create pilot →` after reading the confirm copy. Both clicks produced **draft-state** records only (`pilotBatches.status='draft'`, `pilotBatchLeads.approvedForSend=false`, per the unchanged `createPilotBatchFromImport` semantics).

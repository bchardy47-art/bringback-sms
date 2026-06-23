# DLR dealer correction audit — post 6edcf4e + eccdcba

**Live site tested:** `https://dlr-sms.com`
**Dealer:** `demo@dlr-sms.com` (existing session, post draft-batch creation)
**Most recent deploys confirmed live:**
- `6edcf4e — fix dealer draft campaign bucket planning` (Step 3 + Build Draft)
- `eccdcba — fix dealer campaign preview trust issues` (campaign-detail chip / fallback warnings / blank cards)

**Safety:** No SMS sent. No approve / launch / activate / send / start-sending / enable-live click. No payment, settings, billing, DNS, env, auth changes. No CSV upload this pass. One navigation click into a PREVIEW ONLY campaign-detail page; no action buttons exist there.

---

## A. Executive verdict

- **Guided demo ready?** **Yes**, with a script. The scripted Dashboard → Import → Step 3 → Campaigns (list) → Campaign detail path works end-to-end with no embarrassing artifacts, *if* the dealer stays out of the dashboard's Campaign Overview / All Campaigns link, out of the import page's Blocked filter, off the Settings page, and off mobile.
- **Cold self-serve demo ready?** **No.** A dealer poking around solo will hit the dashboard's stale "Campaign Overview" of template cards (with no link to their actual 4 drafts), the import-page count vs dashboard count mismatch (116 vs 67), the duplicate Logan/Grace stack in the Blocked filter, the Settings page's white-card-on-dark-shell, and an unresponsive layout at narrow widths. Each is a trust-trim, not a trust-killer, but they add up.
- **Dealer trust risk:** **Medium** — eccdcba dropped the trust risk from medium-high to medium. The remaining items are coherence / polish / data-cleanup, not "is this product going to send a message I didn't approve?"
- **Biggest remaining risk in one sentence:** the Dashboard's "Campaign Overview" never reflects the dealer's actual draft batches, so the dealer's first-screen mental model is wrong from the moment they log in.

---

## B. Fix queue

| # | Sev | Page | Issue title | Blocks guided demo? | Owner |
|---|---|---|---|---|---|
| 1 | P1 | `/dealer/dashboard` | Campaign Overview lists template cards, never the dealer's real draft batches | No (avoid the section) | Claude build |
| 2 | P1 | `/dealer/dashboard` vs `/dealer/import` | `Total Leads 67` vs `(N OF 116 LEADS)` — two truths, no reconciliation | No (don't read them aloud in same breath) | Claude build |
| 3 | P1 | `/dealer/import?status=blocked` | Duplicate Logan/Grace rows (4× each) with no dedup label | No (avoid the Blocked filter) | Goose verify + manual cleanup + Claude build |
| 4 | P1 | `/dealer/import` lead list | Pre-existing 20 demo leads still render in the legacy wall-of-yellow-warnings layout next to new lean-chip rows | No (avoid scrolling past row 30) | Manual data cleanup + small layout patch |
| 5 | P2 | `/dealer/settings` | White card on dark shell + barebones (no dealership profile, sender, hours, team) | No (avoid Settings entirely) | Claude build |
| 6 | P2 | `/dealer/inbox` | Tab labels `TAKEN OVER` / `AUTOMATED` aggressive / dev-speak | No | Claude build |
| 7 | P2 | `/dealer/inbox` | Empty state doesn't acknowledge 4 draft batches exist | No | Claude build |
| 8 | P2 | `/dealer/dashboard` | Performance Pulse renders an empty axis line, no real empty state | No | Claude build |
| 9 | P2 | Whole app | No mobile breakpoint — sidebar + hero + 5-card grid stay desktop at 420px | No (don't show on phone) | Claude build |
| 10 | P2 | Sidebar `Continue setup →` | Routes to `/dealer/settings` instead of the dashboard's actual setup card | No | Claude build (1-line href change) |
| 11 | P2 | `/dealer/import` filter dropdown | Falls back to default browser `<select>` styling — off-purple, doesn't match dark theme | No | Claude build (style only) |
| 12 | P3 | Whole app | Brand-tone: `SYSTEM STANDBY / REVIVAL CENTER / DLR POWER LEVEL / ignite revival mode` reads as energy-drink to the dealer-principal persona | No | Claude build (copy pass) |
| 13 | P3 | `/dealer/batches` and `/dealer/batches/<id>` | `PREVIEW ONLY` chip on list view vs `PREVIEWED` chip on detail view — same state, two labels | No | Claude build (rename one) |
| 14 | P3 | `/dealer/import` | `Show required columns` disclosure still a silent no-op (carried over) | No | Claude build or remove |

---

## C. Detailed issues

### Issue 1 — Dashboard "Campaign Overview" doesn't reflect real drafts
- **Severity:** P1
- **Route:** `/dealer/dashboard`
- **Exact visible copy / control:** Section header `CAMPAIGN OVERVIEW` · `ALL CAMPAIGNS →`. Subhead `Campaign templates are ready — upload leads to create personalized campaigns.` Four template cards under it, each with the eye icon and `PREVIEW` badge: `14–30 Day Follow-Up — Recently dead leads — highest revival potential`, `31–60 Day Follow-Up — Mid-window leads cooling off`, `61–90 Day Revival — Cooling leads needing aggressive outreach`, `91+ Day Revival — Long-dormant pipeline — revival sequence`.
- **What is wrong:** The dealer has 4 real PREVIEW ONLY draft batches on `/dealer/batches`. The dashboard doesn't reference them. The four cards here are static template descriptions and never change after upload.
- **Why it matters:** First impression on every login. The dealer's mental model is "campaigns I have" vs "campaigns I could have" — the dashboard tells them the second story while the Campaigns page tells them the first.
- **Likely root cause:** `src/app/(dealer)/dealer/dashboard/page.tsx` — the section appears to be pre-populated from a static templates array rather than queried from `pilotBatches` for the current tenant.
- **Recommended fix:** Query the four most recent draft `pilotBatches` for the tenant. When at least one exists, render those (with their `PREVIEW ONLY` chip + per-bucket lead count). When zero, fall back to the templates and rename the subhead to "Campaign templates are ready — upload leads to start."
- **Acceptance criteria:** Logged in as a tenant with ≥1 draft batch, the dashboard `Campaign Overview` lists the dealer's actual batches with their lead counts; clicking a card → goes to that batch's detail. Logged in as a tenant with zero batches, the section falls back to the existing template list. The `ALL CAMPAIGNS →` link still routes to `/dealer/batches`.

### Issue 2 — Dashboard "Total Leads" vs Import "of N leads" mismatch
- **Severity:** P1
- **Route:** `/dealer/dashboard` ↔ `/dealer/import`
- **Exact visible copy:** Dashboard `TOTAL LEADS 67` and `Today's Pulse → New Leads 67`. Import page header `Review & Select (N of 116 leads)` and bucket cards summing to 116 (80 + 28 + 8 = 116; the 9 Selected is a subset of Ready).
- **What is wrong:** Same tenant, same session, two different counts. The dashboard 67 is the count of `leads` table rows promoted during batch creation; the import 116 is the count of `pilot_lead_imports` rows. Neither screen explains this.
- **Why it matters:** The dealer sees their import page say "116 leads" and their dashboard say "67 total leads" — the first conclusion is "something silently lost ~49 of my leads." It's actually that the 49 difference is non-eligible / non-bucketed import rows that never became `leads`, but nothing on either screen says so.
- **Likely root cause:** Dashboard counts `leads` table; import counts `pilotLeadImports`.
- **Recommended fix:** Either (a) relabel `TOTAL LEADS` → `CUSTOMER LEADS` with a tooltip "Customer records in your CRM after import validation. Items still in review live on Upload Leads.", and add a second small line under it: `+ N in review`. Or (b) match the dashboard to the import page total and break it down `(N total · X ready · Y in review · Z blocked)`.
- **Acceptance criteria:** A dealer can stand on either page and explain to a teammate where their numbers come from without opening the database.

### Issue 3 — Blocked filter: duplicate rows with no dedup label
- **Severity:** P1
- **Route:** `/dealer/import?status=blocked`
- **Exact visible copy:** Eight rows alternating `Logan Stone · ✗ Blocked · 2023 GMC Sierra 1500 · ✗ Invalid phone number: "555-INVALID" — cannot be normalized to E.164` and `Grace Turner · ✗ Blocked · +15550120012 · 2024 Volkswagen Atlas · ✗ Consent has been explicitly revoked — cannot include in pilot`, 4× each.
- **What is wrong:** Two physical customers, eight visible rows, zero indication they're the same person uploaded multiple times. (This is partially my QA-pollution from re-uploads; the *symptom* is a real product gap.)
- **Why it matters:** Dealer reads the Blocked list and concludes "DLR doesn't dedupe by phone."
- **Likely root cause:** Two layers: (a) `importLeads()` doesn't dedupe across upload sessions — only within a single session via `seenPhones` map; (b) the list-render component doesn't show a "duplicate of X" badge.
- **Recommended fix:** (a) Add a per-tenant phone+email dedupe at import time, with a post-upload summary: `X new added · Y already in queue · Z skipped`. (b) Until that ships, manually run a one-off cleanup against the `demo` tenant's `pilotLeadImports` to collapse Logan/Grace down to one row each. (c) Surface a small "Duplicate of …" subtext on imports that share a normalised phone with an existing row.
- **Acceptance criteria:** Re-uploading the same CSV produces zero new rows and a visible "X duplicates skipped" toast. Existing demo tenant's Blocked list shows exactly one Logan Stone and one Grace Turner row.

### Issue 4 — Old demo rows in legacy wall-of-warnings layout
- **Severity:** P1
- **Route:** `/dealer/import` lead list (default + `?status=warning` filter)
- **Exact visible copy:** Brian Hardy / Ashley Martin / Tyler Bennett / Megan Price / Noah Jensen / Olivia Carter / Ethan Walker / Hannah Reed / Jacob Nielsen / Sofia Garcia / Caleb Moore / Emma Young rows all show 3-line yellow warnings: `⚠ Consent status is unknown — verify consent before sending`, `⚠ No vehicle of interest — message preview will use fallback copy`, `⚠ Missing contact date — re-upload this lead with a contact date to include it.` My CSV's needs-date rows (Caleb Morris, Harper Ross) show the lean 1-chip format on the same scroll.
- **What is wrong:** Two different row designs on the same screen for the same conceptual state.
- **Why it matters:** Looks half-deployed in a screenshot.
- **Likely root cause:** These import rows pre-date the lean-chip rewrite; they may have stale `warnings[]` strings that the new renderer still prints verbatim instead of consolidating.
- **Recommended fix:** (a) Demo-data cleanup: delete the pre-existing 20 demo rows and re-seed with rows that go through the post-fix `importLeads()` so the warnings array matches the new shape. (b) Or in the renderer, fold the three legacy `⚠` strings into the lean chip set when they all apply.
- **Acceptance criteria:** Scrolling the import list, every row uses the same chip language and the same per-row layout.

### Issue 5 — Settings page: light card on dark shell + barebones
- **Severity:** P2
- **Route:** `/dealer/settings`
- **Exact visible copy:** Header `Settings · Manage your Revival Center account` in dark text on a white card. Three sections: Account (Name, Email, Save changes), Billing (`No payment method is on file yet. Add a payment method to unlock campaign review and final launch activation. Contact support@dlr-sms.com and we'll resend your activation link.`), Security (Current/New/Confirm password).
- **What is wrong:** (a) Visual: white card sits on the dark `dlr-app-bg` and reads as a different product. (b) Content: zero dealership-level configuration — no store name, sender display name, business hours, team members, opt-out keyword config, branding upload, default workflow, intake notification recipients.
- **Why it matters:** A dealer principal who opens Settings to add their store info finds nothing to add.
- **Likely root cause:** `src/app/(dealer)/dealer/settings/page.tsx` uses a Tailwind light-mode preset; content is the stripped account/billing/security default.
- **Recommended fix:** Dark-mode the card to match the rest of the dealer shell. Add a Dealership Profile section (store name, DBA, address, phone, sender display name). Add Notifications (who gets alerted when a lead replies). Add Team Members. None of these need to be functional on day one — placeholders + "Contact DLR Support to update" are better than absence.
- **Acceptance criteria:** Settings renders in the same dark theme as the rest of the dealer shell. A dealer can see (read-only is fine for v1) their dealership name, sender display name, and team list.

### Issue 6 — Inbox tab names: `TAKEN OVER` / `AUTOMATED`
- **Severity:** P2
- **Route:** `/dealer/inbox`
- **Exact visible copy:** Tabs `NEEDS REVIEW | AUTOMATED | TAKEN OVER | OPTED OUT | CLOSED`.
- **What is wrong:** "Taken over" reads aggressive/military for a sales context. "Automated" is dev-speak.
- **Why it matters:** The dealer's first read of a tab they haven't yet used is the brand promise — these undercut it.
- **Likely root cause:** Inbox tab-list component, probably `src/app/(dealer)/dealer/inbox/*`.
- **Recommended fix:** `TAKEN OVER` → `Handled by you` or `Handed off to sales`; `AUTOMATED` → `Auto replies` or `AI replies`.
- **Acceptance criteria:** Tabs read in plain dealer English; switching tabs continues to filter correctly.

### Issue 7 — Inbox empty state doesn't acknowledge draft batches exist
- **Severity:** P2
- **Route:** `/dealer/inbox`
- **Exact visible copy:** `PRE-LAUNCH — NO CONVERSATIONS YET — Replies will appear here after your first approved campaign sends. You haven't launched one yet — your dashboard shows the next setup step. → Check setup progress`.
- **What is wrong:** Technically accurate (drafts ≠ launched) but the copy implies the dealer hasn't done anything yet, even though they have 4 PREVIEW ONLY drafts ready.
- **Why it matters:** A guided-demo viewer who follows the script and lands on Inbox last reads "you haven't launched one yet" as a critique.
- **Likely root cause:** Inbox page checks for messagesSent > 0, no awareness of pilotBatches count.
- **Recommended fix:** Adjust the empty-state copy when ≥1 draft exists: `Replies will appear here after your draft campaigns are approved and sent. You have N drafts ready for review.` → `Review drafts → /dealer/batches`.
- **Acceptance criteria:** A tenant with drafts but no sends sees a different (acknowledging) empty state than a tenant with zero data.

### Issue 8 — Performance Pulse empty chart
- **Severity:** P2
- **Route:** `/dealer/dashboard` mid-section
- **Exact visible copy:** Section header `PERFORMANCE PULSE — LAST 14 DAYS · Messages · Conversations`. Body: a near-empty axis line with one red baseline and dashed grid.
- **What is wrong:** No empty state. Reads as a broken chart.
- **Why it matters:** Mid-scroll embarrassment on every dashboard view until a real send lands.
- **Likely root cause:** Recharts component renders even when both data series are zero-length.
- **Recommended fix:** When both `messages` and `conversations` are empty, replace the chart with a one-line empty card: `Nothing to show yet — your campaigns haven't started sending.`
- **Acceptance criteria:** A pre-launch tenant sees the empty card. A tenant with at least one send sees the chart with axis labels and the real line(s).

### Issue 9 — No mobile breakpoint
- **Severity:** P2
- **Route:** Whole dealer app
- **Exact visible behaviour:** Resized viewport to 420×900. Sidebar stays full-width, hero with flaming Raptor stays full-width, 5-card Today's Pulse panel stays uncollapsed, dashboard cards don't reflow.
- **What is wrong:** Page is desktop-only.
- **Why it matters:** Lots of dealers check things on a phone between appointments. Today, they can't.
- **Recommended fix:** Real responsive pass: sidebar collapses to a hamburger under `md`, Today's Pulse becomes vertical stack under `sm`, hero crops or hides under `sm`.
- **Acceptance criteria:** At 390×844, the dashboard, import page, campaigns list, and campaign detail are usable without horizontal scroll.

### Issue 10 — Sidebar `Continue Setup →` routes to Settings
- **Severity:** P2
- **Route:** Sidebar nav (visible on every page); click goes to `/dealer/settings`
- **Exact visible copy:** `STANDBY · Complete setup to ignite revival mode · CONTINUE SETUP →`
- **What is wrong:** The actual setup checklist (`Step 2 of 8`) lives on the dashboard. The Settings page doesn't have a setup checklist. Clicking `CONTINUE SETUP` from the sidebar takes you to the wrong page.
- **Likely root cause:** Hard-coded `href="/dealer/settings"` in the sidebar component.
- **Recommended fix:** Change to `/dealer/dashboard#setup-progress` (and add the anchor id to the dashboard's Setup Progress card).
- **Acceptance criteria:** Clicking `CONTINUE SETUP →` lands on the dashboard with the Setup Progress card in view.

### Issue 11 — Filter dropdown default browser styling
- **Severity:** P2
- **Route:** `/dealer/import` — `Review & Select` header
- **Exact visible:** `Filter: <select>` rendering with default browser controls; the option list shows an off-purple highlight in the open state.
- **What is wrong:** Doesn't match the dark theme.
- **Recommended fix:** Restyle to match the rest of the dealer dropdowns (the campaign-bucket chips use `bg-amber-950/60 text-amber-400` etc. — pick a consistent dark-theme select component).
- **Acceptance criteria:** The dropdown reads the same on this page as any other dark-theme select in the dealer app.

### Issue 12 — Brand-tone copy (loud / energy-drink for the persona)
- **Severity:** P3
- **Route:** Header / sidebar / various
- **Exact visible:** `SYSTEM STANDBY — Preparing for launch` (header), `STANDBY — Complete setup to ignite revival mode` (sidebar), `DLR POWER LEVEL` (sidebar widget label), `REVIVAL CENTER` (dealership subtitle), `REVIVE. REENGAGE. REIGNITE.` (dashboard hero), `Revival Pipeline` (Campaigns page).
- **What is wrong:** Heavy-metal / energy-drink language for an audience that's a compliance-conscious dealer principal evaluating a tool that texts their customers.
- **Recommended fix:** Pass through copy with this prompt: "replace any all-caps caps-and-rocket-flames phrase with the plainest dealer-friendly equivalent." Sample swaps: `SYSTEM STANDBY` → `Not live yet`; `DLR POWER LEVEL` → `Setup progress`; `REVIVAL CENTER` → `Dealer portal`; `REVIVE.REENGAGE.REIGNITE.` → kept as a single line, not three.
- **Acceptance criteria:** A read-aloud of the dashboard and import pages contains zero phrases that sound like a movie trailer.

### Issue 13 — `PREVIEW ONLY` chip on list vs `PREVIEWED` chip on detail
- **Severity:** P3
- **Route:** `/dealer/batches` (list) vs `/dealer/batches/<id>` (detail)
- **What is wrong:** Same underlying batch state, two different chip labels.
- **Recommended fix:** Pick one — `PREVIEW ONLY` is more dealer-friendly. Rename the detail chip.
- **Acceptance criteria:** Both list and detail show `PREVIEW ONLY` for the same batch.

### Issue 14 — `Show required columns` disclosure still a no-op
- **Severity:** P3
- **Route:** `/dealer/import` — upload form
- **What is wrong:** Carried over from earliest QA — the disclosure toggle doesn't visibly expand or collapse on click.
- **Recommended fix:** Either wire the expand (with the required-columns list inside) or delete the disclosure entirely — the same information already appears in the "No leads are ready for revival yet" empty-state card.
- **Acceptance criteria:** Click the disclosure → visible content appears or disappears, with a chevron rotation.

---

## D. Demo-safe route

Pages and sections you can confidently include in a guided demo as of today:

1. **Dashboard** — top half: hero + `Not sending yet` banner + `Action needed: Payment setup required` + the four metric cards (Total Leads / Messages Sent / Conversations / Appointments coming soon / Deals Revived). Skip the Campaign Overview section and the Performance Pulse chart.
2. **Setup Progress** at the bottom of the dashboard — clean.
3. **Sidebar nav links** (Dashboard, Upload Leads, Campaigns, Inbox).
4. **Import page top** — the four cards (Ready / Needs Review / Blocked / Selected), the green Review Status panel, the "What DLR needs from you" panel.
5. **Import page Step 2** — scroll through the *new* rows: Mason Reed, Ava Cole, Liam Parker, Emma Hayes, Noah Bryant, Olivia Ward, Ethan Price, Sophia Bell, Caleb Morris, Harper Ross. These are the lean-chip rows with proper per-row chips.
6. **Step 3 / Build draft campaigns panel** — header, subtitle, auto-assigned campaign groups table, safety bullet card.
7. **Campaigns list** (`/dealer/batches`) — all four PREVIEW ONLY cards.
8. **Campaign detail** for any single batch — `Review prepared messages`, `Nothing sends until you approve…` banner, `Cleared for review` chip on each lead, three real messages with bodies, no blank cards, no approve/launch buttons.
9. **Inbox** — yes, even with the imperfect empty state. The `Check setup progress →` CTA is correct.

---

## E. Demo-avoid route

Pages and sections to **not** show during a guided demo until they're patched:

1. **Dashboard "Campaign Overview" section** (issue #1) and the **`ALL CAMPAIGNS →`** link from it — looks contradictory next to `/dealer/batches`.
2. **Dashboard "Performance Pulse — Last 14 Days"** (issue #8) — empty axis reads as broken.
3. **`/dealer/import?status=blocked`** (issue #3) — Logan/Grace × 4 each.
4. **`/dealer/import?status=warning`** (issue #4) — the old wall-of-warnings rows for Brian / Ashley / Tyler / Megan / etc. live here.
5. **Scrolling past row ~30 on the import list** — same reason as #4.
6. **`/dealer/settings`** (issue #5) — white card and bare-bones.
7. **The filter `<select>` dropdown** on import (issue #11) — only if you happen to be on that page.
8. **Mobile / phone display of anything** (issue #9).
9. **Sidebar `Continue Setup →` click** (issue #10) — points to the wrong page.

---

## F. Suggested build packets

Three smallest-high-impact patches, in order.

### Packet 1 — Dashboard Campaign Overview = real drafts
- **Goal:** Make the dashboard's Campaign Overview reflect the dealer's actual draft batches (with a templates fallback when zero).
- **Files / components likely touched:** `src/app/(dealer)/dealer/dashboard/page.tsx`, possibly a small `DealerCampaignOverviewSection` extract. Reads from `pilotBatches` for the tenant, joins `workflows` for the bucket label (the same `ageBucket → DEALER_BUCKET_LABEL` mapping used on `/dealer/batches`).
- **Acceptance criteria:**
  - Tenant with ≥1 draft batch: section header subtitle becomes `Your draft campaigns are ready for review.` Cards list real batches with `PREVIEW ONLY` chip + lead count + bucket label. Each card links to `/dealer/batches/<batchId>`.
  - Tenant with zero batches: section keeps the existing template cards and subtitle `Campaign templates are ready — upload leads to start.`
  - The `ALL CAMPAIGNS →` link still routes to `/dealer/batches` regardless.
- **Tests / checks:** `npx tsc --noEmit`; manual: log in as the demo tenant (which has 4 drafts) → dashboard shows 4 real cards; create a brand-new tenant with no batches → dashboard shows templates.

### Packet 2 — Dedupe on import + post-upload summary
- **Goal:** Stop silently duplicating import rows when a dealer uploads the same CSV twice.
- **Files / components likely touched:** `src/lib/pilot/lead-import.ts` — extend the existing intra-session `seenPhones` / `seenEmails` to also check against existing `pilotLeadImports` rows for the tenant before insert. Return a `{ created, duplicateOfPilotImportId, duplicateOfLeadId }` shape so the upload route can produce a summary.
- Also: tiny UI patch in `src/app/(dealer)/dealer/import/DealerImportForm.tsx` (the upload form's success handler) to show a post-upload summary card: `X new added · Y already in your queue · Z skipped`.
- **Acceptance criteria:**
  - Uploading the same CSV twice in two separate sessions produces zero new rows on the second run.
  - The post-upload summary card explicitly shows the dedupe count.
  - One-time cleanup script run against the demo tenant collapses the existing 4× Logan / 4× Grace stacks to one row each.
- **Tests / checks:** Add a tsx-runnable test in `src/lib/pilot/__tests__/` that calls `importLeads()` twice on the same input array and asserts the second call's return is all duplicates; `npx tsc --noEmit`; manual: upload the demo CSV against the demo tenant, see "12 already in queue" rather than 12 new rows.

### Packet 3 — Settings dark mode + dealership profile placeholder
- **Goal:** Make the Settings page demo-safe.
- **Files / components likely touched:** `src/app/(dealer)/dealer/settings/page.tsx` (or wherever the dealer settings page lives — distinct from any admin settings).
  - Restyle the Account / Billing / Security cards to use the same `dlr-card` shell as the rest of the dealer app.
  - Add a Dealership Profile section above Account: store name, sender display name, address, phone. Read-only is fine on day one with a "Contact DLR Support to update" link if backend writes aren't ready.
- **Acceptance criteria:**
  - Settings looks like the same product as the rest of the dealer shell — no white card on dark background.
  - A new Dealership Profile card renders the tenant's existing `name` from the `tenants` table at minimum.
- **Tests / checks:** `npx tsc --noEmit`; visual diff vs the dashboard's card styling; nothing changes about Save / payment behavior.

---

## G. Data cleanup notes

The product gaps and the demo-data pollution are tangled. Separating:

### Pure code bugs
- **Issue 1** (dashboard Campaign Overview is templates) — code only.
- **Issue 2** (dashboard vs import count mismatch) — code (label or query change).
- **Issue 5** (Settings dark mode + completeness) — code only.
- **Issue 6** (inbox tab names) — code only.
- **Issue 7** (inbox empty state acknowledgment of drafts) — code only.
- **Issue 8** (Performance Pulse empty state) — code only.
- **Issue 9** (no mobile breakpoint) — code only.
- **Issue 10** (sidebar Continue Setup → wrong page) — code only.
- **Issue 11** (filter dropdown styling) — code only.
- **Issue 12** (brand-tone copy) — code only.
- **Issue 13** (PREVIEW ONLY vs PREVIEWED) — code only.
- **Issue 14** (Show required columns no-op) — code only.

### Pure demo-data pollution (introduced by my own re-uploads)
- **The 4× Logan / 4× Grace stack** in the Blocked filter. The next CSV import will keep adding to this until Packet 2 ships. **Recommend a one-off cleanup script** (a tsx script under `scripts/`) that deletes `pilotLeadImports` rows for the demo tenant where `importStatus = 'blocked'` and a row with the same `(tenantId, phoneRaw)` already exists with a lower `createdAt`. Run it once after Packet 2 ships so the dedupe applies going forward and the existing pollution is cleared at the same time.
- **The 3× Mason / 3× Ava / 3× Liam / 3× Emma / 3× Noah / 3× Olivia / 3× Ethan / 3× Sophia / 3× Caleb / 3× Harper** rows in Selected / Eligible / Warning. Same cleanup script can collapse these by `(tenantId, email)`.
- **Drafts:** I clicked Build Draft twice across sessions, but `/dealer/batches` currently shows exactly four cards with sensible lead counts (1 / 2 / 2 / 2). Either the second build folded into the existing batches, or there are hidden duplicate batches not surfacing here. **Recommend a small script** that lists every `pilotBatches` row for the demo tenant + its `pilotBatchLeads` count, so you can decide whether to keep all of them or collapse to four.

### Mixed (code + data)
- **Issue 3** (Blocked duplicates) — needs both the dedupe code (Packet 2) and a one-time data sweep of the demo tenant.
- **Issue 4** (old demo rows in legacy wall-of-warnings) — could be solved by (a) replacing the legacy renderer behavior so old rows get the lean chips on the fly, or (b) deleting and re-seeding the original 20 demo rows. Recommend (b) — simpler, smaller surface, and the existing CSV in `scripts/demo_dealership_guided_demo_import.csv` (+ a similar one for the legacy 20) can be the new demo dataset.

### Recommended data-cleanup sequence
1. After Packet 2 ships, write `scripts/cleanup-demo-tenant-duplicates.ts`: collapses duplicate `pilotLeadImports` rows for the demo tenant, dry-run output first.
2. Run it manually against prod with `VERIFY_TENANT_ID=<demo-tenant-uuid>`.
3. Separately, manually delete the 20 pre-existing legacy demo rows (Brian Hardy, Ashley Martin, etc.) and re-seed via a second CSV that goes through the post-fix `importLeads()`.
4. Verify the Blocked filter shows exactly 1× Logan + 1× Grace and the Eligible / Selected lists have one record per real customer.

---

— No code changed. No prod data changed. QA + audit only.

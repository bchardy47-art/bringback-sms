# DLR first-customer readiness audit

**Live site:** `https://dlr-sms.com`
**Auditor seat:** skeptical dealership owner / GM. Not a friend of the product.
**Safety:** No SMS sent. No approve / launch / send / activate / payment / settings / data-mutation click. Did open one PREVIEW ONLY campaign detail (no controls to fire anything from there).

---

## Headline I want you to read first

**Your prompt says "Dashboard Campaign Overview now shows real draft campaigns." It does not.** I just hard-loaded `/dealer/dashboard?refresh=1` on the live site. The Campaign Overview section is still rendering the four hard-coded template cards with descriptions like `Recently dead leads — highest revival potential.` and the subhead `Campaign templates are ready — upload leads to create personalized campaigns.`

Meanwhile `/dealer/batches` correctly shows the dealer's four real PREVIEW ONLY drafts (1 / 2 / 2 / 2 leads).

So the very first screen a dealer logs into still contradicts the rest of the product, and the team appears to believe it doesn't. That gap is what I'd open with if I were the dealer in the room.

git log shows commit `22ff2597 — show real draft campaigns on dealer dashboard` exists, so either it didn't deploy, the deploy is cached, or what shipped doesn't do what the commit message says. Either way: **not done on the live site**. This is item one in the fix queue below.

---

## A. First-customer verdict

- **Ready to show first customer (cold / unscripted)?** **No.** The dashboard contradiction is fatal on its own; combine with the Blocked filter duplicate stack, the desktop-only layout, and the bare-bones Settings page and a dealer principal will sit there finding things to ask about for fifteen minutes.
- **Ready for a guided demo (we drive)?** **Yes**, but only if you script around at least six pages/sections. Demo-safe path and demo-avoid list below.
- **Ready for self-serve pilot?** **No.** Self-serve means the dealer is poking around on their own. Today they will land on the dashboard contradiction inside ten seconds.
- **Biggest remaining trust risk:** the dashboard's "Campaign Overview" tells a different story than the Campaigns page for the same tenant.
- **Biggest remaining usability risk:** there is no mobile breakpoint. A dealer who opens the link on their phone gets the full desktop layout with a sidebar at 390px.
- **Biggest remaining safety / copy risk:** none of the surfaces I touched today expose an accidental-send path. The campaign detail's `Cleared for review` chip + `Nothing sends until you approve and complete the final launch step with DLR.` banner held up. The only "could read as live" surface is the dashboard's static template cards labelled `PREVIEW` — they imply 4 actual campaigns exist when in the templates branch they're decorative.

---

## B. Red-team summary — what a skeptical dealer notices, ranked by damage

1. **Dashboard says I have no real campaigns yet ("Campaign templates are ready — upload leads to create personalized campaigns.") and I just spent 10 minutes making four campaigns.** The card lists 14-30 / 31-60 / 61-90 / 91+ Day with the eye icon, no lead counts, no link into the actual batch. I scroll, I open Campaigns in the sidebar, I see four PREVIEW ONLY drafts. Which one is true?
2. **Dashboard Total Leads says 67. Upload Leads page says 116. Same dealer, same minute.** Nobody on screen reconciles these. If I have 67 leads or 116 leads matters for what I'm paying you per month.
3. **Blocked filter shows four customers named "Logan Stone" and four customers named "Grace Turner," all with identical reasons.** The screen reads as "DLR doesn't dedupe by phone." (Yes, I know — it's QA pollution from re-uploads, but I'm the dealer and that's what I see.)
4. **The Settings page is a white card on a black app.** It looks like a different product was stapled in. The only fields are Name / Email / Billing / Password. Where's my dealership name, my sender display name, my opt-out keyword config, my team list? If this is the dealer admin surface I'm one click away from asking "do you even know what dealers need to configure?"
5. **The Performance Pulse chart on the dashboard is an empty axis line with no empty-state copy.** Mid-scroll it reads as a broken graph.
6. **At 390-420px wide (my phone) the sidebar stays full-width and the hero stays desktop-sized.** I can't use this from the lot.
7. **Sidebar `Continue Setup →` routes me to Settings, but the actual setup checklist is on the dashboard.** The link goes to the wrong page.
8. **The Inbox empty state says "PRE-LAUNCH — NO CONVERSATIONS YET — Replies will appear here after your first approved campaign sends. You haven't launched one yet."** I have four drafts ready for review. The product won't even acknowledge them on this screen.
9. **The brand voice — `SYSTEM STANDBY / STANDBY / DLR POWER LEVEL / ignite revival mode / REVIVAL CENTER / REVIVE.REENGAGE.REIGNITE.`** — is energy-drink. I'm a 55-year-old dealer principal evaluating a tool that texts my customers about TCPA-sensitive things. This is the wrong volume.
10. **Inbox tabs `TAKEN OVER` and `AUTOMATED`** — "Taken over" reads aggressive/military. "Automated" is dev-speak. Neither is something I'd say out loud to a customer.

---

## C. Fix queue

| Rank | Sev | Route | Issue title | Customer impact | Blocks first-customer demo? | Owner |
|---|---|---|---|---|---|---|
| 1 | **P0** | `/dealer/dashboard` | Campaign Overview still shows static templates; real drafts not surfacing despite git claim | First screen contradicts itself | **Yes** (cold) / No (scripted) | Claude build (re-ship + verify deploy) |
| 2 | P0 | `/dealer/dashboard` ↔ `/dealer/import` | `Total Leads 67` vs `(of 116 leads)` mismatch with no reconciliation | Numbers don't add up | No (don't read both aloud) | Claude build |
| 3 | P1 | `/dealer/import?status=blocked` | 4× Logan + 4× Grace duplicate rows, no dedup indicator | "This product can't dedupe by phone" | No (avoid filter) | Claude build (Packet 2) + manual data cleanup |
| 4 | P1 | `/dealer/import` lead list | 20 pre-existing demo rows render in legacy wall-of-yellow next to lean-chip rows | Looks half-deployed | No (don't scroll past row ~30) | Manual data cleanup + small layout fold |
| 5 | P1 | `/dealer/settings` | White card on dark shell, missing dealership profile fields | "Do you know what dealers actually configure?" | No (avoid page) | Claude build (Packet 3) |
| 6 | P1 | `/dealer/inbox` | Empty state ignores 4 existing drafts | Implies you've done nothing | No | Claude build |
| 7 | P1 | App-wide | No mobile breakpoint at 390px | "Can't use on the lot" | No (don't show on phone) | Claude build |
| 8 | P1 | `/dealer/dashboard` | Performance Pulse renders an empty axis | Reads as broken chart | No (avoid section) | Claude build |
| 9 | P2 | Sidebar | `Continue Setup →` routes to `/dealer/settings` not dashboard setup card | Wrong destination | No | Claude build (1-line href change) |
| 10 | P2 | `/dealer/inbox` | `TAKEN OVER` / `AUTOMATED` tab labels | Tone | No | Claude build (string change) |
| 11 | P2 | App-wide | Brand tone (`SYSTEM STANDBY / DLR POWER LEVEL / REVIVAL CENTER / REVIVE.REENGAGE.REIGNITE.`) | Wrong volume for buyer persona | No | Claude build (copy pass) |
| 12 | P2 | `/dealer/import` filter | Default browser `<select>` styling | Visual inconsistency | No | Claude build (CSS) |
| 13 | P3 | `/dealer/batches` list vs detail | `PREVIEW ONLY` vs `PREVIEWED` chip — same state, two labels | Minor naming consistency | No | Claude build (rename one) |
| 14 | P3 | `/dealer/import` | `Show required columns` disclosure still a silent no-op | One broken minor control | No | Claude build or delete |

---

## D. Detailed tickets

### Ticket 1 — Dashboard Campaign Overview still showing static templates
- **Severity:** **P0**
- **Route:** `/dealer/dashboard`
- **Exact visible:** Card subhead `Campaign templates are ready — upload leads to create personalized campaigns.` Four rows: `14–30 Day Follow-Up · PREVIEW · Recently dead leads — highest revival potential.`, `31–60 Day Follow-Up · PREVIEW · Mid-window leads cooling off.`, `61–90 Day Revival · PREVIEW · Cooling leads needing aggressive outreach.`, `91+ Day Revival · PREVIEW · Long-dormant pipeline — revival sequence.` `ALL CAMPAIGNS →` link to `/dealer/batches`.
- **What is wrong:** The same dealer's `/dealer/batches` page lists four real PREVIEW ONLY drafts with lead counts 1 / 2 / 2 / 2. The dashboard does not reflect any of them. The Packet 1 fix (`commit 22ff2597 — show real draft campaigns on dealer dashboard`) is in git but not behaving on the live site.
- **Why it matters:** First-screen contradiction. The dealer's mental model is wrong from the moment they log in.
- **Likely root cause:** Either (a) the deploy didn't include the commit, (b) the deploy is cached, or (c) what shipped doesn't implement the behaviour the commit message describes. The dashboard is `src/app/(dealer)/dealer/dashboard/page.tsx` — check whether `recentBatchesRaw` is actually queried and whether `hasRealCampaignCards` evaluates true for the demo tenant on the running build.
- **Recommended fix:** Verify what's actually deployed against what's in `src/app/(dealer)/dealer/dashboard/page.tsx` HEAD. If the file on disk has the real-batches branch but live is rendering templates: trigger a rebuild + redeploy and confirm the BUILD_ID changes. If the file on disk doesn't have the real-batches branch: re-apply Packet 1.
- **Acceptance criteria:** Logged in as `demo@dlr-sms.com`, the dashboard's Campaign Overview lists the four actual draft batches with lead counts (1 / 2 / 2 / 2 today), each row clickable to `/dealer/batches/<batchId>`, and the subhead reads `Your draft campaigns are ready for review.` A fresh tenant with zero batches falls back to the existing template list with subhead `Campaign templates are ready — upload leads to start.`
- **Test/check recommendation:** Before / after BUILD_ID compare via `cat /opt/dlr/standalone/.next/BUILD_ID` on the VPS, and a manual verify against the live URL with a query string to defeat any CDN cache.

### Ticket 2 — `Total Leads 67` vs `116 leads` mismatch
- **Severity:** P0
- **Route:** `/dealer/dashboard` ↔ `/dealer/import`
- **Exact visible:** Dashboard `TOTAL LEADS 67` and `Today's Pulse → New Leads 67`. Import page `Review & Select (9 of 116 leads)`; the four cards sum to 80 + 28 + 8 = 116.
- **What is wrong:** Same tenant, same browser tab. Dashboard counts the promoted `leads` table; Import counts `pilotLeadImports`. Neither screen explains it.
- **Why it matters:** "How many leads do I have" is a question a dealer principal will ask their teammate without thinking, and they'll get two different answers depending on which tab is open.
- **Likely root cause:** Different queries against different tables, both labelled `Total Leads`.
- **Recommended fix:** (a) Relabel dashboard `Total Leads` → `Customer leads in CRM` with a one-line subline `+ X in review`, or (b) match dashboard to import-page total (sum of buckets) with a breakdown chip row underneath.
- **Acceptance criteria:** A dealer can stand on either page and explain to their teammate where the number comes from without opening the database.

### Ticket 3 — Blocked filter shows duplicates as separate customers
- **Severity:** P1
- **Route:** `/dealer/import?status=blocked`
- **Exact visible:** `Review & Select (8 of 116 leads)` filtered to Blocked → eight rows alternating `Logan Stone · ✗ Blocked · 2023 GMC Sierra 1500 · ✗ Invalid phone number: "555-INVALID" — cannot be normalized to E.164` and `Grace Turner · ✗ Blocked · +15550120012 · 2024 Volkswagen Atlas · ✗ Consent has been explicitly revoked — cannot include in pilot`, 4× each.
- **What is wrong:** Two real customers; eight visible rows; zero indication these are the same person uploaded multiple times.
- **Why it matters:** The dealer concludes DLR doesn't dedupe.
- **Likely root cause:** `importLeads()` in `src/lib/pilot/lead-import.ts` dedupes only within a single CSV via `seenPhones` map — across sessions every re-upload adds new rows.
- **Recommended fix:** Per-tenant dedupe on phone + email at import time, post-upload summary card `X new added · Y already in queue · Z skipped`. Plus a one-time cleanup script (see section E).
- **Acceptance criteria:** Re-uploading the same CSV produces zero new rows on the second run, the post-upload card shows the dedupe count, and the Blocked filter shows one Logan + one Grace.

### Ticket 4 — Pre-existing demo rows in legacy wall-of-warnings layout
- **Severity:** P1
- **Route:** `/dealer/import` lead list (and `?status=warning` filter)
- **Exact visible:** Brian Hardy / Ashley Martin / Tyler Bennett / Megan Price / Noah Jensen / Olivia Carter / Ethan Walker / Hannah Reed / Jacob Nielsen / Sofia Garcia / Caleb Moore / Emma Young rows all show three yellow warnings stacked: `⚠ Consent status is unknown — verify consent before sending`, `⚠ No vehicle of interest — message preview will use fallback copy`, `⚠ Missing contact date — re-upload this lead with a contact date to include it.` My CSV's needs-date rows (Caleb Morris, Harper Ross) show the lean 1-chip format on the same scroll.
- **What is wrong:** Two designs on one page for the same conceptual state.
- **Why it matters:** Looks half-deployed.
- **Likely root cause:** Old import rows pre-date the lean-chip rewrite; their `warnings[]` arrays still contain the legacy strings the new renderer prints verbatim.
- **Recommended fix:** Either (a) drop and re-seed the legacy 20 rows through the post-fix `importLeads()`, or (b) in the renderer fold the three legacy `⚠` strings into the lean chip set when they all apply. (a) is the cleaner one-time fix.
- **Acceptance criteria:** Scrolling the import list, every row uses the same chip language.

### Ticket 5 — Settings page light-mode + barebones
- **Severity:** P1
- **Route:** `/dealer/settings`
- **Exact visible:** White card with header `Settings · Manage your Revival Center account` on the dark `dlr-app-bg`. Three sections — Account (Name, Email, Save changes), Billing (`No payment method is on file yet. Add a payment method to unlock campaign review and final launch activation. Contact support@dlr-sms.com and we'll resend your activation link.`), Security (Current / New / Confirm password).
- **What is wrong:** (a) Light card on dark shell reads as a different product. (b) Nothing dealership-level: no store name, no sender display name, no business hours, no opt-out keywords, no team members, no notification recipients.
- **Why it matters:** The first place a curious dealer principal clicks to "set things up" is the settings page. Nothing there to set up.
- **Likely root cause:** `src/app/(dealer)/dealer/settings/page.tsx`.
- **Recommended fix:** Restyle to use the same `dlr-card` / `glass` shell as the rest of the dealer app. Add a Dealership Profile section above Account (read-only is fine on day one with `Contact DLR Support to update`).
- **Acceptance criteria:** Settings looks like the same product as the rest of the dealer shell. A dealer can see their dealership name, sender display name, and a team-members list (even if not editable).

### Ticket 6 — Inbox empty state ignores existing drafts
- **Severity:** P1
- **Route:** `/dealer/inbox`
- **Exact visible:** `PRE-LAUNCH — NO CONVERSATIONS YET — Replies will appear here after your first approved campaign sends. You haven't launched one yet — your dashboard shows the next setup step. → Check setup progress`
- **What is wrong:** Technically true (drafts ≠ sent), but the copy implies the dealer hasn't done anything when they have 4 PREVIEW ONLY drafts ready for review.
- **Why it matters:** Reads as a critique of the dealer; they'll click "Check setup progress" and find they're already at "Lead upload ready — done."
- **Likely root cause:** Inbox page conditions only on messages-sent count, ignores draft batches.
- **Recommended fix:** When draft batches > 0 and messages-sent = 0: `Replies will appear here after your draft campaigns are approved and sent. You have N drafts ready for review. → Review drafts → /dealer/batches`.
- **Acceptance criteria:** A tenant with drafts-but-no-sends sees a different (acknowledging) empty state than a tenant with zero data.

### Ticket 7 — No mobile breakpoint
- **Severity:** P1
- **Route:** Whole dealer app
- **Exact visible:** At 420×900 viewport (resized via Chrome MCP `resize_window`), the sidebar stays full-width, the hero Raptor image stays full-width, the 5-card Today's Pulse panel remains uncollapsed.
- **What is wrong:** Page is desktop-only.
- **Why it matters:** Half of every dealer's screen time is on a phone between appointments. Today, they can't.
- **Recommended fix:** Real responsive pass — sidebar collapses to a hamburger under `md`, hero crops or hides under `sm`, KPI grid stacks under `sm`.
- **Acceptance criteria:** At 390×844, the dashboard, import page, campaigns list, and campaign detail are usable without horizontal scroll.

### Ticket 8 — Performance Pulse empty axis
- **Severity:** P1
- **Route:** `/dealer/dashboard` mid-section
- **Exact visible:** Section header `PERFORMANCE PULSE — LAST 14 DAYS · Messages · Conversations`. Body: a near-empty axis line with one red baseline and dashed grid.
- **What is wrong:** No empty state.
- **Why it matters:** Mid-scroll embarrassment on every dashboard view until a real send lands.
- **Recommended fix:** When both `messages` and `conversations` are empty, replace the chart with a single empty card: `Nothing to show yet — your campaigns haven't started sending.`
- **Acceptance criteria:** A pre-launch tenant sees the empty card. A tenant with at least one send still sees the chart.

### Ticket 9 — Sidebar `Continue Setup →` routes to wrong page
- **Severity:** P2
- **Route:** Sidebar (visible on every page)
- **Exact visible:** `STANDBY · Complete setup to ignite revival mode · CONTINUE SETUP →` → links to `/dealer/settings`.
- **What is wrong:** The setup checklist is on the dashboard. Settings is account / billing / password.
- **Likely root cause:** Hard-coded sidebar `href`.
- **Recommended fix:** Change href to `/dealer/dashboard#setup-progress` and add the anchor id to the dashboard's Setup Progress card.
- **Acceptance criteria:** Click → lands on dashboard with the Setup Progress card in view.

### Ticket 10 — Inbox tab labels `TAKEN OVER` / `AUTOMATED`
- **Severity:** P2
- **Route:** `/dealer/inbox`
- **Exact visible:** Tabs `NEEDS REVIEW | AUTOMATED | TAKEN OVER | OPTED OUT | CLOSED`.
- **Recommended fix:** `TAKEN OVER` → `Handled by you` or `Handed off to sales`. `AUTOMATED` → `Auto replies` or `AI replies`.
- **Acceptance criteria:** Plain dealer English; tab filters continue to work.

### Ticket 11 — Brand-tone volume
- **Severity:** P2
- **Route:** Whole app
- **Exact visible:** `SYSTEM STANDBY — Preparing for launch` (header), `STANDBY · Complete setup to ignite revival mode` (sidebar), `DLR POWER LEVEL` (sidebar widget label), `REVIVAL CENTER` (dealership subtitle), `REVIVE. REENGAGE. REIGNITE.` (dashboard hero).
- **Recommended fix:** Replace any all-caps caps-and-rocket-flames phrase with its plainest dealer-friendly equivalent. `SYSTEM STANDBY` → `Not live yet`; `DLR POWER LEVEL` → `Setup progress`; `REVIVAL CENTER` → `Dealer portal`; `REVIVE.REENGAGE.REIGNITE.` → single line.
- **Acceptance criteria:** Read-aloud of dashboard + import contains zero phrases that sound like a movie trailer.

### Ticket 12 — Filter dropdown default browser styling
- **Severity:** P2
- **Route:** `/dealer/import` — Review & Select header
- **Exact visible:** `Filter: <select>` rendering with default browser controls; the open state shows an off-purple highlight.
- **Recommended fix:** Restyle to match the dark theme.
- **Acceptance criteria:** The dropdown matches the other dark-theme selects in the dealer app.

### Ticket 13 — `PREVIEW ONLY` vs `PREVIEWED` chip
- **Severity:** P3
- **Route:** `/dealer/batches` (list) vs `/dealer/batches/<id>` (detail)
- **Exact visible:** List card chip says `PREVIEW ONLY`. Detail page chip says `PREVIEWED`.
- **Recommended fix:** Pick one. `PREVIEW ONLY` reads more dealer-friendly.
- **Acceptance criteria:** Same chip label everywhere.

### Ticket 14 — `Show required columns` disclosure no-op
- **Severity:** P3
- **Route:** `/dealer/import` upload form
- **Recommended fix:** Wire the expand (with the required-columns list inside) or delete it. The same info is already in the import empty-state guidance.
- **Acceptance criteria:** Clicking the disclosure does something visible, or it's gone.

---

## E. Demo-data audit — product bug vs data pollution

| Symptom | Product bug? | Data pollution? | Fix path |
|---|---|---|---|
| 4× Logan Stone / 4× Grace Turner in Blocked | **Yes** — `importLeads()` has no cross-session dedupe | **Yes** — my own QA re-uploads piled them up | Both. Ship Packet 2 (dedupe + summary), then run a one-off cleanup script with `VERIFY_TENANT_ID=<demo>` to collapse the existing stacks. |
| 3× each of Mason / Ava / Liam / Emma / Noah / Olivia / Ethan / Sophia / Caleb / Harper in Selected and Warning | Same as above | Same as above | Same. |
| 20 pre-existing demo rows (Brian Hardy / Ashley Martin / Tyler Bennett / Megan Price / Noah Jensen / etc.) in the old wall-of-warnings layout | Partial — the renderer should consolidate when all three legacy `⚠` strings apply, but the data pre-dates the lean-chip rewrite | Yes — these legacy rows have `warnings[]` arrays in the old shape | **Recommend manual data cleanup:** delete these 20 rows from `pilotLeadImports` for the demo tenant, then optionally re-seed them by replaying a CSV through the post-fix `importLeads()`. Cleaner than patching the renderer. |
| `/dealer/batches` shows 4 PREVIEW ONLY cards (1 / 2 / 2 / 2 leads) | No bug observed | Possibly: I clicked Build Draft twice across sessions. The system collapsed both clicks into 4 batches (with low lead counts because `pilotBatchLeads … onConflictDoNothing()` left some leads attached to earlier batches) | **Recommend a one-time dry-run audit script** that lists every `pilotBatches` row + its `pilotBatchLeads` count for the demo tenant, so the team can decide whether to delete the lower-count duplicates or leave them. |
| Dashboard `Total Leads 67` vs Import `116 leads` | Yes — labels are not synonyms but neither screen says so | No | Code fix per Ticket 2. |
| Dashboard Campaign Overview shows templates | Yes — fix in git not behaving on live | No | Code fix + deploy verify per Ticket 1. |

### Suggested cleanup script (dry-run first)

```ts
// scripts/cleanup-demo-tenant-duplicates.ts (dry-run by default)
// Set APPLY=1 to actually mutate.
// 1) Within the demo tenant's pilotLeadImports, group by (phone, email).
// 2) Keep the OLDEST row per group. Mark the rest excluded.
// 3) Print a summary: groups, rows kept, rows excluded.
// 4) Optional: delete the legacy "Brian Hardy / Ashley Martin / Tyler Bennett /
//    Megan Price / Noah Jensen / Olivia Carter / Ethan Walker / Hannah Reed /
//    Jacob Nielsen / Sofia Garcia / Caleb Moore / Emma Young" rows if their
//    warnings[] still match the legacy 3-string pattern.
```

Run with `DATABASE_URL=… VERIFY_TENANT_ID=<demo-uuid> npx tsx scripts/cleanup-demo-tenant-duplicates.ts` (dry-run), inspect output, then `APPLY=1` to mutate.

---

## F. Safety audit

- **Is there any visible path where a dealer could accidentally send SMS?** **No on the surfaces I touched.**
  - `/dealer/dashboard` `UPLOAD MORE LEADS` and `OPEN INBOX` are navigation only.
  - `/dealer/dashboard` `FINISH PAYMENT SETUP` is the highest-stakes button; correctly labelled, doesn't read as "already charged."
  - `/dealer/import` `Build draft campaigns (N leads) →` produces a confirm panel `This will create N draft campaigns. No messages will be sent until each campaign is reviewed and approved.` and then `Yes, create pilot →` which only creates draft `pilotBatches` (status `draft`, `approvedForSend=false`). Verified end-to-end in prior pass — no send semantics.
  - `/dealer/import` `Generate Report` is correctly labelled `No sends, no enrollments.`
  - `/dealer/batches/<id>` campaign detail has **no Approve / Launch / Send / Activate button visible** on the surfaces I scrolled. Only `← All Campaigns`, `Dashboard`, `Inbox` text links at the bottom. Page header subtitle says `Read the exact messages before anything sends. Approval only prepares the campaign for final launch with DLR.`
- **Are approval / send / launch controls exposed anywhere I reached?** No. Approvals appear delegated to DLR-side ("complete the final launch step with DLR"). That's the right shape for the first pilot — but **worth re-verifying with multi-lead batches.** The demo batches today only have 1–2 leads. Per-lead approve toggles on a multi-lead batch could be hidden behind the smaller dataset I'm looking at.
- **Does any copy imply messages have already started?**
  - The static template cards on the dashboard are tagged `PREVIEW` which is fine, but the cards have descriptions like `Recently dead leads — highest revival potential` that read as "this campaign is running" if you skim. Fixed once Packet 1 actually lands.
  - The Inbox preview card says `No conversations yet. Approved campaigns will land here once live.` — accurate, no implication of live sends.
- **Are draft / preview / no-send labels consistent?** Mostly yes. The campaigns list says `PREVIEW ONLY`; the detail says `PREVIEWED`. Same state, two labels. Pick one (Ticket 13).
- **Are opt-out / STOP messages visible in previews where appropriate?** Yes — every Message 1 preview I read ends with `(Reply STOP to opt out)`. Messages 2 and 3 don't repeat it, which is the correct TCPA pattern (STOP needs to appear at least once, not in every message).

---

## G. First-customer demo-safe path

Use exactly this script. Don't deviate.

1. **Dashboard top** — Hero + `Not sending yet` banner + `Action needed: Payment setup required` + the five Today's Pulse rows. Say: *"This is the dealer control center. Right now you're in standby — DLR has not sent a single message to your customers."*
2. **Sidebar nav** — point at the four items (Dashboard / Upload Leads / Campaigns / Inbox), don't click them yet.
3. **Click Upload Leads.** Show the four cards (Ready / Needs Review / Blocked / Selected) and the green `Leads are ready for review — N leads validated and grouped into 4 campaign groups.` Stop at the cards row. Say: *"DLR doesn't assume anything is safe — every lead is checked for date, source, phone, and consent before it gets near a draft campaign."*
4. **Scroll the new-style rows only.** Mason Reed / Ava Cole / Liam Parker / Emma Hayes / Noah Bryant / Olivia Ward / Ethan Price / Sophia Bell / Caleb Morris / Harper Ross. Point out Liam's `Using last activity date` chip and one new-row consent + bucket + date-source chip set. Then **stop scrolling** — do not enter the legacy-rows zone or the Blocked filter.
5. **Scroll to Step 3.** Show the header `Build Draft Campaigns — 9 leads selected across 4 groups`, subtitle `No messages send from this step. You will review every preview before approval.`, and the per-bucket auto-assigned table. **Do not click Build draft** — it's already been built; pointing at the panel is enough.
6. **Click Campaigns in the sidebar.** Show the four PREVIEW ONLY cards in the Revival Pipeline. Read the four-step status legend at the top (Preview only → Ready for review → Approved — not sending yet → Live / Sending) and point at where the dealer's drafts currently sit.
7. **Click `View Campaign →` on the 14-30 Day card.** Show the `Cleared for review` chip, `Nothing sends until you approve and complete the final launch step with DLR.` banner, and the three real message previews including `Reply STOP to opt out` on Message 1. Say: *"The dealer reviews the exact words their customer will get, before a single text is sent."*
8. **Click `← All Campaigns` to go back, then click Inbox.** Show the `PRE-LAUNCH — NO CONVERSATIONS YET` empty state. Frame as "this is where replies land after the dealer approves and DLR activates." (Note: this card claims `you haven't launched one yet`, which contradicts the four drafts — but if your script doesn't dwell, the dealer doesn't catch it.)
9. **Close on the dashboard** — back to the safety story. *"That's the loop: import old leads, classify them safely, block risky ones, group eligible leads, prepare draft campaigns, review previews, approve. You stay in control."*

Total time: about 6–7 minutes. **Do not improvise off this path.**

---

## H. First-customer demo-avoid list

Do not navigate to, mention, click, or scroll into any of the following until they're fixed:

1. **Dashboard "Campaign Overview" section** (it's lying)
2. **Dashboard `ALL CAMPAIGNS →` link from within the Campaign Overview section** (jumps from templates to real drafts, which is the contradiction)
3. **Dashboard "Performance Pulse — Last 14 Days" chart** (empty axis)
4. **Sidebar `Continue Setup →`** (wrong destination)
5. **`/dealer/import?status=blocked`** (4× Logan + 4× Grace)
6. **`/dealer/import?status=warning`** (legacy wall-of-warnings rows)
7. **Scrolling past row ~30 on the import list** (legacy rows live there)
8. **The `Filter:` `<select>` on `/dealer/import`** (default-browser styling)
9. **`/dealer/settings`** (white card, barebones)
10. **The chat-bubble and gear icons in the top-right** (untooltipped duplicates of Inbox / Settings)
11. **Mobile or phone-sized window** (no breakpoint)
12. **Brand-tone read-alouds: "SYSTEM STANDBY", "DLR POWER LEVEL", "REVIVAL CENTER", "REVIVE. REENGAGE. REIGNITE."** — read the dashboard hero as plain English, skip the eyebrow phrases.

---

## I. Build plan — next 5 patches in order

### Patch 1 — Verify and (re-)deploy Packet 1: Dashboard Campaign Overview shows real drafts
- **Goal:** Make `/dealer/dashboard`'s Campaign Overview reflect the dealer's actual draft batches with the new subtitle, today.
- **Files likely touched:** `src/app/(dealer)/dealer/dashboard/page.tsx` (verify the real-batches branch is in HEAD), and the deploy pipeline (verify `BUILD_ID` on `/opt/dlr/standalone/.next/BUILD_ID` matches the new commit).
- **Risk:** Low — read-only change.
- **Acceptance criteria:** On the live URL, after a hard reload with a query-string cache buster, the dashboard's Campaign Overview lists four real batch cards (each clickable to `/dealer/batches/<batchId>`) with the new subtitle `Your draft campaigns are ready for review.`
- **Checks/tests:** Manual visual verify + a `cat /opt/dlr/standalone/.next/BUILD_ID` to confirm new build deployed. No new automated test needed; this is a regression in the deploy pipeline as much as in the code.
- **Owner:** Claude build (and a Goose verify on the live URL after).

### Patch 2 — Dedupe on import + post-upload summary
- **Goal:** Stop silently duplicating import rows on re-upload.
- **Files likely touched:** `src/lib/pilot/lead-import.ts` (extend `seenPhones` / `seenEmails` to query existing `pilotLeadImports`); `src/app/(dealer)/dealer/import/DealerImportForm.tsx` (post-upload summary card).
- **Risk:** Medium — touches the hot import path.
- **Acceptance criteria:** Uploading the same CSV twice in two separate sessions produces zero new rows on the second run; post-upload summary card shows `X new added · Y already in your queue · Z skipped`; running `scripts/cleanup-demo-tenant-duplicates.ts --apply` collapses the existing 4× Logan / 4× Grace and the 3× Mason / etc. stacks.
- **Checks/tests:** Add `src/lib/pilot/__tests__/dedupe-on-reimport.test.ts` (tsx-runnable, no DB — use a fake `db` or split the dedupe predicate into a pure helper). Manual: upload demo CSV against demo tenant, see "12 already in queue" rather than 12 new rows.
- **Owner:** Claude build.

### Patch 3 — Settings dark mode + dealership profile placeholder
- **Goal:** Make `/dealer/settings` demo-safe.
- **Files likely touched:** `src/app/(dealer)/dealer/settings/page.tsx`.
- **Risk:** Low.
- **Acceptance criteria:** Settings page renders in the same dark theme as the rest of the dealer shell (no white card on dark background). A new Dealership Profile section above Account shows `tenants.name`, sender display name, address, phone. Read-only is OK on day one; do not add a write path in this patch.
- **Checks/tests:** Manual visual diff vs `/dealer/dashboard` card styling. `npx tsc --noEmit -p tsconfig.json`.
- **Owner:** Claude build.

### Patch 4 — Inbox empty state + sidebar `Continue Setup →` href + tab renames
- **Goal:** Three small string / route changes; bundle them.
- **Files likely touched:** the inbox empty-state component, the sidebar nav component, the inbox tab-list component. Plus the dashboard's Setup Progress card to add an anchor id.
- **Risk:** Low.
- **Acceptance criteria:**
  - When `draftCount > 0 && messagesSent === 0`, the inbox empty state reads `Replies will appear here after your draft campaigns are approved and sent. You have N drafts ready for review. → Review drafts → /dealer/batches`.
  - Sidebar `Continue Setup →` href becomes `/dealer/dashboard#setup-progress`; the dashboard's Setup Progress card has `id="setup-progress"`.
  - Inbox tabs read `Needs review | Auto replies | Handled by you | Opted out | Closed`.
- **Checks/tests:** Manual click-through; `npx tsc --noEmit`.
- **Owner:** Claude build.

### Patch 5 — Performance Pulse empty state + Total Leads label disambiguation
- **Goal:** Stop the dashboard's middle two cards from undermining the rest of the page.
- **Files likely touched:** `src/app/(dealer)/dealer/dashboard/page.tsx`.
- **Risk:** Low.
- **Acceptance criteria:**
  - Performance Pulse: when `messagesSent === 0 && conversations === 0`, render a single empty card `Nothing to show yet — your campaigns haven't started sending.` instead of the axis SVG. Tenants with any send still see the chart.
  - Total Leads KPI label changes to `Customer leads in CRM` and a small line under it reads `+ X in review` (where X = `pilotLeadImports` count). Or the simpler version: keep the label but add a `+X in review` chip — pick whichever is cleaner in the existing layout.
- **Checks/tests:** Manual visual verify on demo tenant.
- **Owner:** Claude build.

— No code changed. No data mutated. Brutal QA + report only.

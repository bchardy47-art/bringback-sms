# DLR dealer deep-pass QA — beyond the happy path

**Live site:** `https://dlr-sms.com`
**Account:** `demo@dlr-sms.com` (logged-in session, post draft-batch creation)
**Safety:** No SMS sent. No approval / launch / activation / send / start-sending control clicked. No payment, settings, DNS, env, auth, or billing changes. Did navigate into one campaign-detail page (PREVIEWED draft, no approve button visible).

---

## A. Verdict

- **Guided demo ready?** Yes — *if* the demo script keeps the dealer on Dashboard → Import → Step 3 → Campaigns *card* view. Stay out of the Blocked filter and out of campaign detail unless the script explicitly stages around what's there.
- **Cold self-serve demo ready?** **No.** A dealer poking around solo will hit the blocked-row duplicate stack, the stale "no vehicle on file" warnings on every message preview, the empty MESSAGE 2 / MESSAGE 4 entries, the green `✓ Approved for send` chip on a draft batch, and the dashboard-vs-Campaigns "Campaign Overview" mismatch. Each of those is a trust-killer on its own.
- **Dealer trust risk:** **Medium-high.** The shell is professional and the safety copy is real, but the *campaign detail* page (the screen the dealer reads most carefully — it's the SMS they're about to send to customers) contradicts itself in several places and shows warnings that are factually wrong.

---

## B. Top 5 blockers, ranked

### P0 — Campaign detail shows `✓ Approved for send` next to every lead's name **inside a PREVIEWED draft batch**
- **Page:** `/dealer/batches/<batchId>` (campaign detail) — visible on every lead card.
- **Exact visible copy:** Green pill `✓ Approved for send` next to `Mason Reed` while the batch header chip reads `PREVIEWED` and the page subtitle says `Read the exact messages before anything sends. Approval only prepares the campaign for final launch with DLR.`
- **Why it matters:** This is the screen where a dealer principal decides whether to trust DLR. The page is a *draft* preview, but the per-lead chip says the lead is approved for send. Two screens, two truths. A compliance-minded reader will either think DLR has silently flipped the switch on this lead, or stop trusting all the "no-send" copy elsewhere.
- **Fix:** Either rename the chip to `Eligible for inclusion` / `Cleared for review` when the batch is still in `previewed` / `draft` state, or hide the chip entirely until the batch reaches `approved`. The chip should never say "Approved for send" while the page header says PREVIEWED.

### P0 — Every message preview on every selected lead shows `⚠ no vehicle on file` **even when the vehicle is on file**
- **Pages:** `/dealer/import` lead rows (the `⚠ fallback` chip per message) and `/dealer/batches/<batchId>` (the `⚠ no vehicle on file` link per message).
- **Exact visible copy on campaign detail for Mason Reed:** `MESSAGE 3 — 3 days after previous · ⚠ no vehicle on file` while the same card header shows `2024 Ford F-150 XLT`. Same pattern for every selected lead.
- **Why it matters:** The whole demo value prop is "DLR personalises revival messages with the customer's vehicle". If every preview says "no vehicle on file" with the vehicle name printed right above, the dealer's read is "this product can't even use the data I gave it." It also looks like a per-message data-quality alarm bell.
- **Fix:** Re-render previews when the bucket workflow is provisioned (the stored `previewMessages` row was cached before the workflow existed, so `vehicleOfInterest` defaulted to `null` and the renderer logged a fallback). In `createPilotBatchFromImport`, force-refresh `previewMessages` for any row that lacks a vehicle-aware preview, or just always re-run `renderImportLeadPreview` on batch creation rather than keying off `existing.length === 0`.

### P0 — "MESSAGE 2" and "MESSAGE 4" render as empty body cards
- **Page:** `/dealer/batches/<batchId>` campaign detail — visible on Mason Reed's card.
- **Exact visible copy:** `MESSAGE 2 ················· Sends first` (empty body) and `MESSAGE 4 ················· Sends first` (empty body), sandwiched between real messages.
- **Why it matters:** The dealer reads "this campaign sends 5 messages but two are blank". These are actually `condition` (stopIfReplied) steps from the workflow template, but the UI is treating every position in the step list as a message.
- **Fix:** Filter `workflow_steps.type === 'send_sms'` before rendering. Don't number condition / assign steps. Bonus: also fix the `Sends first` timing label that's being applied to the empty entries.

### P1 — Dashboard "Campaign Overview" never reflects the dealer's actual draft batches
- **Page:** `/dealer/dashboard`.
- **Exact visible copy:** Campaign Overview lists `14–30 Day Follow-Up · PREVIEW` / `31–60 Day Follow-Up · PREVIEW` / `61–90 Day Revival · PREVIEW` / `91+ Day Revival · PREVIEW` with template descriptions ("Recently dead leads — highest revival potential", etc.), regardless of what's on `/dealer/batches`. Subhead `Campaign templates are ready — upload leads to create personalized campaigns.`
- **Why it matters:** The Campaigns page shows the dealer's real draft batches. The Dashboard's "Campaign Overview" shows generic template cards. Same dealer, same screen scroll, two different worlds. A demo viewer asks "where are the four drafts I just made?"
- **Fix:** Either (a) replace dashboard "Campaign Overview" with the latest *real* draft batches when they exist (fall back to templates when zero), or (b) clearly label this section "Template library — upload leads to start" and move the "actual drafts" link to a separate card.

### P1 — Blocked rows show every duplicate as its own line item, with no dedup indicator
- **Page:** `/dealer/import?status=blocked`.
- **Exact visible copy:** Eight rows reading `Logan Stone · ✗ Blocked · 2023 GMC Sierra 1500 · ✗ Invalid phone number: "555-INVALID" — cannot be normalized to E.164` and `Grace Turner · ✗ Blocked · +15550120012 · 2024 Volkswagen Atlas · ✗ Consent has been explicitly revoked — cannot include in pilot`, alternating 4× each.
- **Why it matters:** The visible message to the dealer is "four different Logan Stones uploaded a 555-INVALID phone." A dealer principal who knows their CRM will conclude DLR can't dedupe by phone. (The underlying cause is my own QA re-uploads, but the *symptom* is a real product gap.)
- **Fix:** Dedupe at import time by phone + email; surface a post-upload summary card `X new added, Y already in your queue, Z skipped`. At minimum, mark the visible rows `· duplicate of …` so the dealer doesn't read them as eight distinct customers.

---

## C. Safety findings

**Any accidental-send risk?** Low on the surfaces I reached:

- `/dealer/import` Step 3 confirm panel correctly walls the create-batch action behind explicit copy `This will create N draft campaigns. No messages will be sent until each campaign is reviewed and approved.` That stayed intact.
- `/dealer/batches/<batchId>` (campaign detail) shows the messages but **no Approve / Launch / Send / Activate button is visible on the page**. The bottom nav links are `← All Campaigns`, `Dashboard`, `Inbox`. The header pill `Nothing sends until you approve and complete the final launch step with DLR.` matches what the page does — a dealer cannot self-send from here.
- `FINISH PAYMENT SETUP` on the dashboard is the highest-stakes button — it's correctly labelled `FINISH PAYMENT SETUP` (not `COMPLETE PAYMENT`), so it doesn't read as already-charged.
- `Generate Report` on the import page is correctly labelled `No sends, no enrollments.`

**Approval/launch/send controls exposed?** None observed in the dealer scope. Approvals appear to be DLR-side ("Approval only prepares the campaign for final launch with DLR"). That's the right shape for first-pilot safety. **Worth double-checking** that there's truly no per-lead approve toggle on campaign detail when more leads are in the same batch — the demo case had only 1 lead per batch which may hide a per-lead UI.

**Unclear no-send / draft wording:** the `✓ Approved for send` chip described in P0 above is the only one that reads as "this lead is going out" — and it appears even on PREVIEWED batches. That's the safety problem to fix first.

---

## D. Dealer-confusion findings

1. **Duplicate uploaded leads accumulate silently.** Across uploads I see 4× Logan Stone, 4× Grace Turner in Blocked; 3× each of Mason / Ava / Liam / Emma / Noah / Olivia / Ethan / Sophia / Caleb / Harper in the regular list. The system happily creates a fresh import row each time, with no warning. The UI doesn't flag them as duplicates anywhere.

2. **Count mismatch: Dashboard "Total Leads 67" vs Import "116 leads"**. The Review & Select header reads `(9 OF 116 LEADS)`; the four cards above sum to 80 ready + 28 needs review + 8 blocked = 116. The dashboard's `TOTAL LEADS` and `Today's Pulse → New Leads` both show **67**, which is the count of records that made it through to the `leads` table after batch creation. Two screens, two numbers, no explanation of which is which.

3. **Stale message previews.** Already counted as P0 in B, but worth repeating in the confusion bucket: every selected lead's preview rows show `⚠ fallback` / `⚠ no vehicle on file` even when the vehicle is right there. The previews were rendered once and cached; the auto-provisioned bucket workflow's data context isn't re-applied.

4. **Old demo rows still render in the old wall-of-warnings layout.** The 20 pre-existing demo leads (Brian Hardy, Ashley Martin, Tyler Bennett, Megan Price, Noah Jensen, Olivia Carter, Ethan Walker, Hannah Reed, Jacob Nielsen, Sofia Garcia, Caleb Moore, Emma Young, etc.) show 3-line `⚠ Consent status is unknown / ⚠ No vehicle of interest / ⚠ Missing contact date — re-upload this lead` per row. My CSV's rows (Caleb Morris, Harper Ross) show the lean format. Side by side on the same scroll.

5. **Inbox `TAKEN OVER` / `AUTOMATED` tabs** — same finding from prior passes. "Taken over" reads aggressive/military; "automated" is dev-speak. Now compounded by the 4 drafts existing — the dealer might wonder why the inbox still says `PRE-LAUNCH / NO CONVERSATIONS YET — You haven't launched one yet`. Technically accurate (drafts ≠ launched), but the copy doesn't acknowledge the drafts at all.

6. **`1 fallback` chip in the campaign detail header** reads like a problem report ("one fallback was used") when actually it means "one lead's preview used the no-vehicle fallback template" — which itself is wrong given the vehicle data exists. Doubly confusing.

7. **`PREVIEWED` chip vs `Preview only` chip** — the campaigns list calls it `PREVIEW ONLY`; the campaign detail header calls it `PREVIEWED`. Same state, two labels.

8. **Filter dropdown styling** on `/dealer/import` falls back to a default browser `<select>` with an off-purple background, doesn't match the dark theme — visible at top right of Review & Select header.

---

## E. Polish findings

- **Settings page** is still the white card on the dark shell. Bare-bones: Name / Email / Billing / Password. No dealership store info, no sender display name, no team members, no business hours, no opt-out keyword config. Unchanged from the very first QA pass.
- **Performance Pulse — Last 14 Days** chart on the dashboard renders an empty axis line with no real empty state.
- **Sidebar `STANDBY — Complete setup to ignite revival mode — CONTINUE SETUP →`** still routes to `/dealer/settings`, not to the dashboard's setup checklist where the actual `Step 2 of 8` lives. Misleading link target.
- **Sidebar header `Demo Dealership / REVIVAL CENTER`** — "Revival Center" is product naming, not the dealership label.
- **Top-bar pill `SYSTEM STANDBY — Preparing for launch`** — accurate but the "Standby" word reads as broken to non-technical users.
- **Mobile / narrow viewport** — I resized to 420px wide. The dashboard kept the desktop layout: sidebar visible full-width, hero with flaming Raptor at full width, 5-card Today's Pulse panel uncollapsed. No mobile breakpoint observed. Same finding as the first pass.
- **Bottom-left profile dropdown** still clips when the viewport is short.
- **`/dealer/upload` correctly redirects to `/dealer/import`** ✓ — this prior 404 is fixed.
- **The "What does fallback mean?" disclosure** on campaign detail is a genuinely good explainer: `Fallback templates are used when a lead's vehicle of interest isn't on file — they're still personalized to first name and dealership.` The problem is it's incorrectly triggered (see P0 #2).
- **Empty body MESSAGE 2 / MESSAGE 4** entries (see P0 #3) are the worst polish issue — would be visible in literally every campaign detail screenshot.

---

## F. What to fix before showing High Country

### Must fix before guided demo
1. **Replace or hide `✓ Approved for send` chip** while the batch is in PREVIEWED state. (P0 #1)
2. **Re-render message previews after auto-provisioning the bucket workflow** so vehicles render and the `⚠ no vehicle on file` / `⚠ fallback` alarms go away when the data is on file. (P0 #2)
3. **Filter `condition` and `assign` steps out of the message list** on campaign detail so MESSAGE 2 / MESSAGE 4 aren't empty. Renumber visible messages. (P0 #3)
4. **Hide the Blocked filter from the demo path** *or* dedupe the blocked rows so Logan / Grace appear once each. (P1)
5. **Make the dashboard "Campaign Overview" either reflect actual drafts or be labelled "Template library"**. (P1)

### Can mention / avoid during guided demo
- Stay on Mason Reed / Liam Parker rows during the row-level review — Mason and Liam are the cleanest cards.
- Don't open the Blocked filter ("8 blocked" is fine to read in the card, but don't scroll the list — duplicates are visible).
- Don't open the dashboard's "All Campaigns →" link until the Dashboard Campaign Overview is fixed.
- Don't navigate to campaign detail by clicking `View Campaign →` until P0 #1, #2, #3 are fixed. Stay on the Campaigns *list* view for the guided demo.
- Don't show the Settings page (white card on dark shell, bare-bones).
- Don't try mobile / narrow viewport on a phone — there is no mobile breakpoint.

### Post-demo polish
- Dedupe-on-import + post-upload summary (`X new added, Y already in your queue, Z skipped`).
- Backfill the pre-existing 20 demo leads through the new pipeline so the import page renders one consistent row design.
- Settings: dealership store info, sender display name, business hours, opt-out keywords, team members.
- Performance Pulse: real empty state.
- Sidebar `Continue setup →` should route to the dashboard's actual setup card, not Settings.
- Filter dropdown styling on `/dealer/import`.
- Mobile breakpoint pass on the whole dealer flow.
- Brand-copy tone pass on STANDBY / REVIVAL CENTER / TAKEN OVER / AUTOMATED.

---

## G. Suggested next build order — smallest high-impact first

1. **Rename / hide the `✓ Approved for send` chip on PREVIEWED-state batches** (1-line conditional render in the batch detail component). Fixes the single biggest dealer-trust risk surfaced in this pass. Cheap.
2. **Filter `condition`/`assign` steps out of the campaign-detail message list and renumber.** Small component-level fix. Removes "blank MESSAGE 2 / MESSAGE 4" from every demo screen.
3. **Force-refresh `previewMessages` in `createPilotBatchFromImport`** when the assigned workflow was just provisioned. Removes the false `⚠ no vehicle on file` warnings everywhere. This is the same change surface as my prior bucket-plan fix.
4. **Dedupe import rows by email + phone, with a post-upload summary card.** Bigger surface, but the highest-impact second-impression fix once the demo gets past the happy path. Also lets you fold the existing 4-deep Logan/Grace stacks into single rows next time the demo data is rebuilt.
5. **Replace dashboard "Campaign Overview" with the latest real draft batches when any exist** (fall back to templates only at zero). Keeps the dashboard story coherent with the Campaigns page.
6. **Settings dark mode + dealership profile fields** — the lowest-urgency of the must-fix-eventually list, but the easiest to demo around.

— No code was changed in this pass. QA only.

# DLR dealer portal — full QA click-through

**Tested as:** demo@dlr-sms.com (logged-in dealer session on the live site).
**CSV used:** `scripts/demo_dealership_guided_demo_import.csv` (12 rows).
**Safety:** did not send SMS, did not approve/launch a campaign, did not click `FINISH PAYMENT SETUP`, did not change billing/auth/settings, did not generate any report. Did upload CSV, did check both attestations, did test wrong-password (with a saved Chrome credential to recover), did test the row-level checkbox UX (which surfaced a destructive surprise — see below).

---

## A. Overall verdict

**Guided demo ready** — with a scripted walkthrough that avoids the row-level checkbox, the duplicate-upload case, the Settings page, and the dashboard/import lead-count mismatch. **Not cold-demo ready.**

The product story is genuinely good: clear safety framing, useful "What DLR needs from you" panel, lean new-row chip layout, accurate consent + date validation, Liam Parker's fallback note works, and the campaign-templates wording on the Campaigns page resolves the prior contradiction. The remaining problems aren't aesthetic — the lead-level checkboxes silently delete leads, the dashboard counts disagree with the import counts, the demo dataset still mixes new-style and old-style row layouts on one screen, and there is no way to actually select leads to prepare a campaign.

---

## B. Top 5 blockers

1. **The leftmost row checkbox on the import page silently removes a lead** instead of selecting it. Clicking Mason Reed dropped Ready from 56 → 55, total from 84 → 83. Clicking Liam Parker dropped them again. No warning, no undo, no confirmation. This is the single biggest trust-killer in the entire flow — the dealer expects "select for campaign," gets "delete from list."
2. **There is no visible way to actually select leads to prepare a campaign.** Step 3 says "CREATE CAMPAIGN — SELECT LEADS ABOVE FIRST," but the only per-row affordances are (a) the row checkbox (which excludes), (b) "Mark reviewed" (does not change selection), and (c) an "x" (which excludes). The "Auto-selecting eligible leads…" line at the top of the lead list never resolves — `SELECTED FOR CAMPAIGN` stayed at 0 for 5+ minutes with 56 eligible leads sitting in Ready.
3. **Dashboard total leads (34) ≠ import page total (82+).** After uploading the demo CSV, the import page reads `82 leads imported and validated`, while the dashboard reads `TOTAL LEADS 34` and `New Leads 34`. The dealer will pick one and decide the app is wrong.
4. **Duplicate-upload has no dedupe and no surfaced warning.** Uploading the same CSV twice in the same session adds duplicate rows for every lead and surfaces the duplicates inside "blocked" (two Logan Stones, two Grace Turners), but never tells the dealer "8 rows already exist." Re-uploading a CRM export is the most common dealer mistake; this needs a guard.
5. **The 20 pre-existing demo leads still render with the old wall-of-yellow-warnings**, sitting on the same scroll as the new chip-layout rows from my CSV. From a sales-demo perspective the page looks unfinished because it's literally two different designs side-by-side.

---

## C. Punch list by priority

### P0 — must fix before first guided demo

- Lead-row leftmost checkbox: stop using it for delete. Make it the selection control. Move "exclude" behind the "x" only, with a confirm.
- Wire up actual lead selection. Either: auto-select all eligible on import (the "Auto-selecting eligible leads…" copy already implies this), or surface a "Select all eligible" button at the top of the list.
- Sync dashboard `TOTAL LEADS` with the import page total, or relabel one of them so the dealer knows what each count means.
- Replace the 20 pre-existing demo leads (or re-process them) so the import page renders one consistent row design.
- Add a dedupe warning on re-upload: "X rows match leads already in your queue — skipped" (or, alternatively, hard-block with a "found duplicates" preview).

### P1 — should fix before any cold demo

- Wrong-password: the "Sign in" button stays visually greyed-out after a failed attempt even though it is not actually disabled. Restore active styling so the dealer doesn't think they're locked out.
- "Show required columns" disclosure on the import page is still a silent no-op (clicked four times, no visible expand, chevron doesn't rotate, label doesn't change). The empty-state card already lists the columns elsewhere — either wire this up or remove it.
- Two consent attestation checkboxes still say roughly the same thing. Consolidate to one.
- Attestation checkboxes still reset to unchecked after a successful upload. If the dealer needs to fix and re-upload, they re-attest.
- Settings page is still light-mode on the dark shell. Visually reads as a different product.
- Settings is still barebones (Name, Email, Billing, Password). At minimum add dealership store info, sender display name, business hours, and team members before the first demo question lands.
- Dashboard sidebar's "DLR POWER LEVEL" + vertical "POWER" meter + "ignite revival mode" copy is dead weight against the persona. Replace with a plain "Setup progress" widget.
- "REVIVAL SEQUENCES" header above CAMPAIGNS, "REVIVAL CENTER" subtitle under the dealership name, "SYSTEM STANDBY — Preparing for launch" top-bar pill: all internal-jargon-feeling labels. Plain language plays better.
- Inbox tab "TAKEN OVER" reads aggressive; "AUTOMATED" reads dev-speak. Suggest "Handled by you" and "Auto replies" or "AI replies".

### P2 — post-demo polish

- Performance Pulse chart still renders as a near-empty axis line. Add a real empty state ("Nothing to show yet — your campaigns haven't started sending").
- URL `/dealer/batches` should be `/dealer/campaigns` for consistency with the sidebar label.
- Top-right chat-bubble icon and gear icon are redundant with sidebar Inbox + Settings, and have no tooltips.
- Profile dropdown in the bottom-left clips when the viewport is short. Anchor it upward.
- Mobile/responsive: the page does not appear to have mobile breakpoints (sidebar stays full-width at narrow viewports in my testing harness; this needs verification on a real phone).
- 4 dashboard "PREVIEW" campaign tiles are now correctly framed as templates in the Campaigns page subhead — keep that copy in sync with whatever the templates look like once a real campaign is prepared.

---

## D. Feature-by-feature findings

### Login
- Public landing page → `Dealer Sign In` → `/login`. Form is clean, light theme, password autofill works.
- Wrong-password produces a clear, security-sensible message: `⚠ Invalid email or password.` Good — doesn't leak whether the email exists.
- After a failed attempt, the `Sign in` button stays grey/disabled-looking. It's not actually disabled in the DOM, but the visual cue suggests the user is rate-limited or stuck.
- `/login` is not redirect-protected when you're already signed in; visiting it as an authenticated dealer shows the form anyway. Minor.

### Dashboard
- Theming: "REVIVE.REENGAGE.REIGNITE." in three-tier red caps over a flaming Ford Raptor. "TODAY'S PULSE," "DLR POWER LEVEL" + vertical "POWER" meter, "SYSTEM STANDBY — Preparing for launch" in the top bar, "REVIVAL CENTER" subtitle. Energy-drink vibe. The persona is a dealer principal evaluating a compliance tool; the volume of metal-themed words is louder than the product story.
- Action banner: `Action needed: Payment setup required` + `FINISH PAYMENT SETUP` — clean, no contradiction. (Previous pass had "Payment received" with "COMPLETE PAYMENT" — fixed.)
- `TOTAL LEADS 34` on the dashboard while the import page shows 82+ imported. Mismatch.
- `Campaign Overview` subhead is now `Campaign templates are ready — upload leads to create personalized campaigns.` Good — resolves prior contradiction with the Campaigns page.
- `Setup Progress: 25% — Step 2 of 8` is clean and consistent now that the sidebar reads `STANDBY` instead of a competing percentage.
- `Performance Pulse — Last 14 Days` chart shows only an axis line with no empty-state copy.

### Import
- Layout buckets: `READY FOR REVIVAL` (green), `NEEDS REVIEW` (yellow), `BLOCKED FOR SAFETY` (red), `SELECTED FOR CAMPAIGN`. Clear, action-oriented.
- `/dealer/upload` now redirects to `/dealer/import` instead of 404'ing. ✓ Fix landed.
- "What DLR needs from you" panel: actionable, prioritized, with counts and remedies including "no action needed" on blocked. Still the single best section.
- CSV upload: attestations gate the file picker; the page correctly transitions from "Check the attestation above before uploading" to "Click to browse, or drag and drop a .csv file" once both boxes are checked.
- After upload, **all 12 rows landed** this time: 8 ready, 2 needs review, 2 blocked. Silent-drop bug from the prior pass appears fixed.
- Liam Parker correctly shows `Using last activity date` ✓. Mason / Ava / Emma / Noah / Olivia / Ethan / Sophia show `Using lead created date` ✓.
- Bucket assignment by recency works: Mason 24 days → 14-30 Day Follow-Up; Emma 48 days → 31-60 Day Follow-Up; Noah 73 days → 61-90 Day Revival; Ethan 121 days → 91+ Day Revival.
- New-row layout: 2 chips (consent + Eligible/Needs Date) + vehicle + 1 date-source chip. Lean and readable.
- Old demo rows (Brian Hardy, Ashley Martin, Tyler Bennett, Emma Young, etc.) still show 3-line wall-of-yellow-warnings on the same scroll.
- Duplicate upload silently doubled rows — no merge, no warning. After second upload, the `BLOCKED FOR SAFETY` section showed both `Logan Stone` blocks and both `Grace Turner` blocks back-to-back.
- "Show required columns" disclosure is wired to a button but the click has no visible effect across four attempts.
- Filter dropdown (`All / Selected / Eligible / Warning / Held / Needs Review / Blocked`) didn't visibly apply when the dropdown option was clicked through the accessibility tree; needs a manual verify on a real mouse.

### Lead review / selection
- Per-row controls (left → right): a checkbox, the lead name, consent chip, eligibility chip, vehicle, campaign chip, age, date-source chip, `Mark reviewed`, `x`.
- **The checkbox at the left removes the lead** when clicked. Total dropped by 1, Ready dropped by 1, SELECTED stayed at 0. The dealer who tries to "select Mason" loses Mason. There is no toast, no confirmation, no undo button.
- "Auto-selecting eligible leads…" header above the list never produced a non-zero `SELECTED FOR CAMPAIGN` count after 5+ minutes with 56 ready leads.
- Step 3 (Create Campaign) is gated behind a selection that there is no path to make through the visible UI.

### Campaign preview
- Could not produce. Step 3 card reads `⚠ Select eligible leads in Step 2 to unlock this.` Step 2 selection is broken, so Step 3 was inaccessible.
- Copy is correctly safe: `Creates a draft campaign only. You'll review each campaign before anything is sent.` Reassuring — once selection works, this part is ready.
- `Generate Report` button under "Preview Report — Generates a read-only report of current import status. No sends, no enrollments." is well-labeled. Did not click — copy is clear that it's safe, but skipped under the user's "don't generate reports" interpretation of safety.

### Campaigns
- Empty state now reads `NO PREPARED CAMPAIGNS YET — Campaign templates are ready. Upload leads and DLR will prepare personalized message sequences for your review — nothing sends until you approve.` This resolves the prior dashboard-says-4-campaigns / page-says-zero contradiction.
- Status legend (Preview only / Ready for review / Approved — not sending yet / Live / Sending) is clear.
- `REVIVAL SEQUENCES` super-header is still gimmicky; `Campaigns` is enough.
- URL slug is `/dealer/batches`; the sidebar item is "Campaigns." Internal-word leak in the address bar.

### Inbox
- Pre-launch empty state: `PRE-LAUNCH — NO CONVERSATIONS YET — Replies will appear here after your first approved campaign sends. You haven't launched one yet — your dashboard shows the next setup step.` Clean.
- Tabs: NEEDS REVIEW / AUTOMATED / TAKEN OVER / OPTED OUT / CLOSED. "TAKEN OVER" and "AUTOMATED" are the rough ones.
- Could not test conversation detail, Take Over, or Reply — no conversations exist.

### Settings
- Still light-mode card on a dark app shell. Visually inconsistent.
- Contents: Account (Name, Email), Billing ("No payment method is on file yet"), Security (current/new/confirm password). That's it.
- No dealership store info, no team members, no sender display name, no business hours, no opt-out keyword config, no notification settings, no branding/logo.
- Billing copy on Settings is consistent with the dashboard banner ("No payment method is on file yet" / "Payment setup required"). ✓ Prior contradiction fixed.

### Navigation / mobile
- Sidebar: Dashboard, Upload Leads, Campaigns, Inbox. All reachable. `/dealer/upload` now redirects to `/dealer/import` correctly.
- Profile dropdown (bottom-left): Demo Dealer, email, Settings, Log out. Minimal but functional.
- Top-right header has chat-bubble (→ Inbox) and gear (→ Settings). Redundant with sidebar, untooltipped.
- Mobile: my best evidence is that the harness's `resize_window` reported the new size but the captured screenshot continued to render at desktop layout (sidebar visible, no mobile nav). Suggestive but not conclusive — should be verified on a real phone.

### Copy / tone
- Loudest offenders: "REVIVE. REENGAGE. REIGNITE." (3-tier red caps headline), "DLR POWER LEVEL" + vertical "POWER" meter, "ignite revival mode," "SYSTEM STANDBY," "TODAY'S PULSE," "REVIVAL SEQUENCES," "REVIVAL CENTER," "DEALER PRINCIPAL" all caps under the avatar.
- Dealer-friendly wins kept: "No customer messages will be sent…" banner, "No messages are sent from this page" on the upload page, the "What DLR needs from you" panel, the per-blocked-row explanation, the "Click to browse, or drag and drop a .csv file" empty state.

---

## E. Exact broken buttons / dead ends

| Page | Element | What happened | Expected | Suggested fix |
|---|---|---|---|---|
| `/dealer/import` | Leftmost row checkbox on `Mason Reed` row | Lead disappeared, Ready 56→55, Total 84→83 | Lead becomes Selected for Campaign, Selected counter +1 | Wire the row checkbox to selection. Make the rightmost `x` the only exclude action, with a confirmation step. |
| `/dealer/import` | Leftmost row checkbox on `Liam Parker` row | Same: Liam removed, Ready 55→54 | Same: lead Selected | Same. |
| `/dealer/import` | `Show required columns` disclosure | No visible expand/collapse on click; chevron stays `>`; label stays `Show required columns` | Toggles a list of required CSV columns (firstName, lastName, phone, …) with example values | Wire up the disclosure, rotate the chevron, swap label to `Hide required columns` when open. |
| `/dealer/import` | "Auto-selecting eligible leads…" status line | Stays as text indefinitely; `SELECTED FOR CAMPAIGN` remains 0 | Either auto-select and update the counter, or remove the misleading copy | Either implement auto-select on import or replace with `Select all eligible →` button. |
| `/dealer/import` | Re-upload of identical CSV | 12 duplicate rows added silently; `BLOCKED FOR SAFETY` shows both Logan/Grace twice | Show "X rows already in your queue — skipped" summary | Dedupe by email + phone on import; emit a post-upload summary card. |
| `/dealer/import` | `Mark reviewed` link on a row in `Needs Date` state | Marks reviewed but lead remains ineligible | Either hide `Mark reviewed` when the lead can't progress, or have it acknowledge and offer the next step (`Add contact date`) | Conditionally render the action so its label matches what it does. |
| `/login` | `Sign in` button after a failed attempt | Stays styled grey/disabled-looking even though it's clickable | Return to active black styling once the user edits the password field | Trigger the active style on input change. |
| Dashboard | `TOTAL LEADS 34` card vs import page total `82+` | Two different totals on two screens | Same number on both, or different labels with a tooltip explaining what each means | Pick one source of truth; relabel as needed. |
| Dashboard | `Performance Pulse — Last 14 Days` chart | Renders a near-empty axis line | Empty-state copy: "Nothing to show yet — your campaigns haven't started sending." | Add the empty state. |
| Header | Chat-bubble + gear icons (top right) | No tooltip, no labels | Tooltips: "Inbox" / "Settings" | Add `aria-label` + `title`. |

---

## F. Confusing or incomplete information

| Where | Exact copy | Why confusing | Suggested replacement |
|---|---|---|---|
| Dashboard top bar | `SYSTEM STANDBY — Preparing for launch` | Sounds like a system error. "Standby" reads as "broken." | `Not live yet — finish setup to start sending` |
| Dashboard sidebar | `STANDBY` + `Complete setup to ignite revival mode.` + `CONTINUE SETUP →` | "Ignite revival mode" is brand speak; the link routes to `/dealer/settings`, which doesn't actually let you "continue setup." | `Setup in progress — Continue setup →` routed to the dashboard's own Setup Progress card. |
| Dashboard "TODAY'S PULSE" | `TODAY'S PULSE` | Internal label, not a metric a dealer would say out loud. | `Today` |
| Dashboard banner | `Action needed: Payment setup required` + `FINISH PAYMENT SETUP` | (Improved — keeping this row as a 'good example' for the rest of the page.) | (Keep.) |
| Import top hero | `LEAD OPERATIONS` + `UPLOAD LEADS` over Raptor flames | "Lead operations" reads military/internal. | Drop the supertitle; keep `Upload leads`. |
| Import status copy | `Auto-selecting eligible leads…` | Promises a behavior that never happens. | Either implement it or change to a `Select all eligible (56) →` button. |
| Import attestations | Two checkboxes with overlapping legal language | Doubles the friction without doubling the legal weight. | One checkbox: "I confirm we have lawful consent to text these leads, none have opted out, and they're from our dealership's records." |
| Per-row warnings (old leads only) | 3-line wall of yellow `⚠ Consent status is unknown…` / `⚠ No vehicle of interest…` / `⚠ Missing contact date — re-upload this lead with a contact date to include it.` | Looks like the lead is unrecoverable; "re-upload one lead" isn't how dealers fix data. | Single chip with tooltip. Inline "Add contact date" date picker on the row. |
| Lead row controls | Leftmost checkbox | Looks like a "select for campaign" affordance; actually excludes. | Change to selection; move exclude to the `x` with a confirm. |
| Campaigns header | `REVIVAL SEQUENCES` over `CAMPAIGNS` | Internal product name; dealer doesn't need both. | Drop the supertitle. |
| Inbox tab | `TAKEN OVER` | Reads aggressive/military. | `Handled by you` |
| Inbox tab | `AUTOMATED` | Dev-speak. | `Auto replies` or `AI replies` |
| Sidebar bottom | `Demo Dealer / DEALER PRINCIPAL` (all caps) | Title in all caps shouts at a job title that isn't load-bearing. | Title case: `Dealer principal`. |
| Sidebar above sidebar avatar | `Demo Dealership / REVIVAL CENTER` | "Revival Center" is product copy, not the dealership name. | Drop the second line or replace with the dealership city. |

---

## G. Safety concerns

- **No accidental send risk observed.** Every send/launch button is behind step 3 ("Create Campaign — Select Leads Above First"), which is gated behind selection, which I could not actually do. The "Generate Report" button is correctly labeled `No sends, no enrollments.` The `FINISH PAYMENT SETUP` button is the highest-stakes button visible — it was not clicked, and its rename from `COMPLETE PAYMENT` reduces the false-alarm potential.
- **High accidental-delete risk.** The leftmost row checkbox silently removes leads. A first-time dealer trying to "select Mason for the demo" will instead delete Mason from the list. No confirmation, no undo, no toast. This is the safety concern of the run.
- **No confirmation on the exclude `x`.** Pairing one-click row removal with one-click row exclusion means a misclick on a row instantly costs a lead.
- **Re-upload double-counts blocked leads with no audit trail.** Two Logan Stones appearing in the Blocked list with the same "Invalid phone number" reason is the kind of thing a compliance-minded dealer principal will flag.
- **Wrong-password disabled-looking button** could push a dealer to keep clicking or to assume they're locked out and call support.

---

## H. Dealer-voice summary

> As a dealer, I felt mostly relieved by the safety copy — every screen tells me nothing sends until I approve, and the upload page is genuinely clear about what's wrong with my CSV. But the second I tried to pick the five leads I'd actually run a pilot against, the app deleted them. I clicked a checkbox to select Mason Reed and he disappeared. I tried Liam Parker, same thing — gone. Then I noticed my dashboard says I have 34 leads and the upload page says I have 82, and I'm not sure which is true. The look — the flaming truck, the "REVIVE. REENGAGE. REIGNITE." — is fine in the marketing email, less fine on a tool I'm supposed to trust with my customer list. I'd let a DLR rep walk me through a demo, but I wouldn't try to run a pilot from this on my own yet.

---

## I. Final recommended build order

1. **Fastest must-fix (1–2 days).** Stop the row-level checkbox from deleting. Either point it at selection or disable it entirely until step 2 selection ships. While you're in there, hide the `Mark reviewed` action on rows the user can't actually progress, and gate the row-`x` behind a confirm.
2. **Next trust fix (≈1 week).** Implement step-2 selection for real. Either auto-select all eligible on import (matching the "Auto-selecting eligible leads…" copy that's already shipped) or add a `Select all eligible (N) →` button at the top of the list. Wire that into the SELECTED counter and into the step-3 unlock. Add upload-time dedupe by email + phone with a post-import summary ("X new, Y already in your queue, Z skipped"). Sync dashboard `TOTAL LEADS` with import page total.
3. **Demo data / campaign fix (parallel).** Re-process or replace the 20 pre-existing demo leads so the import page renders one consistent row design. Drop the dataset name "Brian Hardy" (matches the demo dealer's name) and switch to "Sample Lead 1–20." Confirm campaign template names map to a real preview path once selection works.
4. **Polish (next sprint).** Settings dark mode + dealership profile + sender display name + team members. Replace the loudest brand-copy offenders (POWER LEVEL, SYSTEM STANDBY, REVIVAL CENTER/SEQUENCES, "TAKEN OVER", "AUTOMATED"). Performance Pulse empty state. Disclosure for "Show required columns." Header icon tooltips. Real mobile breakpoint pass.

---

## Caveats

- Did not click `Log out` (no password on hand for re-entry — Chrome's saved credential is in the harness but I'd rather not bet a session on it during a QA pass). The dropdown was confirmed present and labeled `Log out`.
- Did not click `FINISH PAYMENT SETUP`, `Generate Report`, `Sign in` (with the real password), or any send / launch / approve control.
- Did upload the demo CSV (twice in this pass, intentionally, to test re-upload dedupe), did check both attestations both times, did click the leftmost row checkboxes on Mason and Liam to test selection — both leads disappeared as described.
- The "no visible mobile breakpoint" finding is based on the harness's resize behavior; a real phone test is still worth doing.

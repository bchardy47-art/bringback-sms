# DLR dealer portal — first-dealer QA

**Auditor's frame:** Sales manager / dealer principal at an independent rooftop. Not technical. Trying to figure out whether to trust this thing with their CRM and their compliance liability.

**Tested:** Dashboard, Upload Leads, Campaigns, Inbox, Settings. Did not send SMS, did not approve any campaign, did not click Complete Payment.

---

## 1. Dealer-readiness verdict

**Not ready** for a cold first-dealer demo. Near-ready for a guided demo *if* you script around the issues below and pre-seed the demo account with eligible leads.

The product safety story (consent gating, attestations, "no messages sent from this page", review-before-send) is real and clearly communicated. That's the strongest part. But almost everything around it — the theming, the contradictory status copy, the dead-end demo data, the half-finished Settings page, the 404 with no nav — adds up to "is this a finished product?" The dealer will not feel calm.

---

## 2. Top 5 demo blockers

1. **Demo dealership has 20 leads imported and 0 are eligible.** Every lead shows "⛔ not eligible yet / ? Needs Date" with the instruction "re-upload this lead with a contact date to include it." A dealer walking the flow hits a dead end at step 1. Step 3 ("CREATE CAMPAIGN — SELECT LEADS ABOVE FIRST") is permanently locked. They can't see what a healthy campaign looks like.
2. **Dashboard says "Action needed: Payment received" with a "COMPLETE PAYMENT" CTA, but Settings → Billing says "No payment method is on file yet."** These two screens contradict each other. The dashboard banner reads, on first glance, like "you've been charged" — which is alarming. (`/dealer/dashboard`, `/dealer/settings`)
3. **Setup progress shows two different completion percentages on the same screen.** Sidebar power meter shows **45%**. The setup card shows **25% (Step 2 of 8)**. Same page, two numbers. The dealer will not know which to trust.
4. **Campaigns page says "NO CAMPAIGNS YET"** while the dashboard's "Campaign Overview" lists 4 campaigns (14–30, 31–60, 61–90, 91+) with `PREVIEW` tags. They're previews of templates, not real campaigns — but the dealer doesn't know that. They'll click through expecting to see something and get the empty state.
5. **Settings page is rendered in light/white mode on top of the dark app shell.** Visually it looks like a different product was bolted on. First impression of "is this finished?"

---

## 3. Top 10 friction points

1. **Theming is too aggressive for the buyer persona.** "REVIVE. REENGAGE. REIGNITE." in giant block caps over a flaming Ford Raptor, plus "DLR POWER LEVEL," "SYSTEM STANDBY / Preparing for launch," "TODAY'S PULSE," "REVIVAL SEQUENCES," "REVIVAL CENTER," "ignite revival mode," EKG line, vertical "POWER" meter — reads as energy-drink/gaming aesthetic. A 55-year-old dealer principal evaluating a compliance tool is going to wonder if this is serious software. Tone it down at minimum 50% for a dealer demo; keep the brand idea but lose the screaming.
2. **The upload page contradicts itself.** Top banner says "20 leads imported and validated. Pick eligible leads below to assemble your first campaign." Underneath: 20 NEEDS DATE / 0 READY / 0 ELIGIBLE. Nothing is actually pickable. The copy should match the state.
3. **Every lead has 4–5 stacked warnings.** Walls of yellow `⚠` text under every name. Even when a lead has a vehicle on file, it still gets "Consent status is unknown" and "Missing contact date." Dealer thinks: "my CRM export is broken." Group warnings into a single chip with a tooltip, or move to a per-lead Fix panel.
4. **"Re-upload this lead with a contact date to include it"** is a dead-end instruction. The CSV is already in the system; asking the user to re-upload one row is not how dealers think. Offer inline fix (a date picker per row) or batch fix ("apply contact date to all missing").
5. **Two near-identical consent attestation checkboxes stacked together.** "I confirm these leads are from our dealership/customer records…" + "SMS Consent Certification required — I certify that this dealership has the right to contact these leads…" Both say the same thing in different words. Consolidate to one checkbox; the legal weight isn't increased by repetition and the friction is.
6. **`Show required columns` button doesn't visibly do anything when clicked.** Critical help affordance silently no-ops (or expands somewhere invisible). Dealer who needs to know the CSV format gives up.
7. **`/dealer/upload` returns a bare black 404 page.** A reasonable guess at the upload URL (the sidebar item is literally "Upload Leads") gives "404 — This page could not be found." on a black screen with no logo, no link back, nothing. The real path is `/dealer/import`. Either add the alias or polish the 404 with a "Back to dashboard" link and DLR branding.
8. **No store/business profile in Settings.** Settings has Name, Email, Billing, Password — that's it. No dealership name, address, store hours, sender display name, team members, opt-out keyword config, default vehicle inventory, signature. A dealer principal will ask "where do I add my store info / hours / staff?" — and there's no answer.
9. **"DLR groups leads by age" disclosure was not tested visibly opening** — make sure these disclosures are obviously expandable (chevron rotates, content slides). At least one disclosure on the upload page never visibly changed state.
10. **`?` Needs Date chip + ⛔ "not eligible yet" + "Mark reviewed" button per row** = three competing affordances on each lead row. What does the dealer actually do here? The primary action ("Mark reviewed") doesn't fix the problem ("Needs Date"). The dealer will click Mark Reviewed expecting it to do something useful, then be confused when the lead still isn't eligible.

---

## 4. Exact pages where issues appear

| Page | URL | Issues |
|---|---|---|
| Dashboard | `/dealer/dashboard` | "Action needed: Payment received" contradiction; sidebar 45% vs setup card 25%; 4 PREVIEW campaigns shown but Campaigns page is empty; Performance Pulse chart renders empty/skeletal; heavy theming |
| Upload Leads | `/dealer/import` | Banner says validated/pickable but 20/20 are NEEDS DATE; "Show required columns" silent no-op; duplicate attestations; "re-upload" dead-end fix instruction; Step 3 permanently locked |
| Upload Leads (wrong URL guess) | `/dealer/upload` | 404 with no nav back, no branding |
| Campaigns | `/dealer/batches` | "NO CAMPAIGNS YET" contradicts dashboard's Campaign Overview; URL slug `batches` (internal word) leaks into address bar |
| Inbox | `/dealer/inbox` | Tab label "TAKEN OVER" reads aggressive; "AUTOMATED" is dev-speak; empty-state copy is actually good here |
| Settings | `/dealer/settings` | Light-mode card on dark shell; bare-bones (no dealership info, no team, no sender ID, no opt-out keywords); Billing copy contradicts dashboard |

---

## 5. Exact copy / UI suggestions

| Current | Replace with | Why |
|---|---|---|
| `Action needed: Payment received` + `COMPLETE PAYMENT` | `Action needed: Add payment method` + `Add payment method` | "Received" reads as "we got your money" — alarming |
| `20 leads imported and validated. Pick eligible leads below…` | `20 leads imported. 0 ready — 20 need a contact date before we can send.` | Match copy to actual state |
| `Re-upload this lead with a contact date to include it.` | `Add a contact date` (button) — opens inline date entry | Dealers don't re-upload one row |
| Two attestation checkboxes | One checkbox: `I confirm we have lawful consent to text these leads, none have opted out, and they're from our dealership's records.` | Single attestation, one click |
| `DLR POWER LEVEL` / `ignite revival mode` | `Setup progress` | Plain language |
| `SYSTEM STANDBY — Preparing for launch` | `Not live yet — finish setup to start sending` | "Standby" reads like the app is broken |
| `TODAY'S PULSE` | `Today` | |
| `REVIVAL SEQUENCES` (Campaigns header) | `Your campaigns` | |
| `REVIVAL CENTER` (subtitle under dealership name) | `Dealer portal` or omit | |
| `TAKEN OVER` (inbox tab) | `Handled by you` | "Taken over" reads aggressive/military |
| `AUTOMATED` (inbox tab) | `Auto replies` or `AI handled` | Dev word |
| `Mark reviewed` (when lead is not eligible) | Hide or disable until lead is eligible | Creates false sense of progress |
| `Preview Report` / `Generate Report` | Move or hide until there's something to report | Dead button in current state |
| `REVIVE. REENGAGE. REIGNITE.` hero | Keep brand voice, drop the giant tri-stack — use as a one-line header instead | Reads as energy drink, not SaaS |
| Sidebar `45%` vs setup card `25%` | Single source of truth, show on both | Inconsistency erodes trust |

---

## 6. Buttons that are dangerous or unclear

- **`COMPLETE PAYMENT`** (dashboard) — looks like a payment confirmation. Stopped before clicking per instructions. Needs to read as "Add payment method" and probably route to a Stripe Checkout, not look like a confirmation.
- **`Mark reviewed`** (per-lead row) — implies it advances the lead; actually does nothing useful for ineligible leads. Should be hidden/disabled until lead is eligible.
- **`Generate Report`** (Preview Report card on import page) — unclear what it produces, when, and whether it's safe. Copy says "no sends, no enrollments" which is good, but the button is below a wall of warnings, so the dealer is already nervous.
- **`Continue setup`** (sidebar) routes to `/dealer/settings`, which only has Account/Billing/Password — Setup is actually on the dashboard. This is a wrong redirect.
- **Top-right chat-bubble icon** — unlabeled; couldn't tell if it's support, in-app chat, or notifications without clicking. Did not click. Needs a tooltip.
- **Top-right gear icon** — fine, but redundant with sidebar Settings (there's already a `Demo Dealership settings` link in the header).
- **Profile dropdown chevron in lower-left** — opens a tiny popover anchored to the avatar; cut off at the window edge. Need to verify it stays on screen at all viewport heights.

---

## 7. Fix before first dealer demo

Hard blockers:

1. Pre-seed the demo dealership with **eligible** leads so the dealer can actually click through Upload → Review → Campaign Preview. Right now the demo dies at step 1.
2. Resolve the **Payment received / No payment method** contradiction. Pick one truth and tell it everywhere.
3. Resolve the **45% vs 25% setup progress** contradiction.
4. Resolve the **Campaigns "no campaigns" vs dashboard "4 PREVIEW campaigns"** contradiction (likely: rename the dashboard tiles to "Campaign templates" or "What we'll build for you").
5. **Dark-mode the Settings page** so it matches the rest of the app.
6. **Polish the 404 page** with branding + a "Back to dashboard" link.
7. **Fix or remove "Show required columns"** — currently a silent no-op.
8. **Consolidate the two consent attestations** to one.
9. **Tone down the theming.** Keep the brand idea but remove "POWER LEVEL," vertical "POWER" meter, EKG line, "SYSTEM STANDBY," and the all-caps hero. Replace one or two and the demo will feel dramatically more professional.
10. **Rename "TAKEN OVER" and "AUTOMATED" tabs** in the inbox.

---

## 8. Can wait until after demo

- Build out Settings (team, sender display name, hours, opt-out keywords, dealership profile).
- Inline lead-edit (date picker on the row) so dealers can fix problems without re-uploading.
- True mobile/responsive layout (testing at ~390px in this audit suggests the page doesn't have a mobile breakpoint — sidebar stays visible, hero doesn't reflow; caveat that the resize from the testing harness may not perfectly simulate a phone, but I saw no evidence of mobile styles).
- Per-row warning consolidation (single chip + tooltip).
- Performance Pulse chart polish — currently renders as a near-empty skeleton.
- Tooltips on the chat-bubble and gear icons in the top header.
- Profile dropdown anchoring/positioning at small heights.
- URL hygiene: `/dealer/batches` → `/dealer/campaigns`; add an alias from `/dealer/upload` → `/dealer/import`.

---

## 9. Visually broken / half-finished

- **Settings page**: white card on dark shell. Visually a different product.
- **Performance Pulse — Last 14 Days** chart: renders as just an axis line with no data. Empty-state should say "Nothing to show yet — your campaigns haven't started sending."
- **404 page**: bare black with `404 — This page could not be found.` Nothing else.
- **Dashboard hero** at the tested width still shows the flaming Raptor at full width with no reflow. Probably fine on desktop, but the lack of any visible breakpoint suggests mobile is untested.
- **Sidebar "DLR POWER LEVEL" + vertical "POWER" meter** is a lot of visual real estate for what is functionally just a 45% progress bar.
- The "Show required columns" disclosure does not visibly expand or collapse when clicked.
- The first lead in the demo (`Brian Hardy`) is shown as `✓ Reviewed` while all others say `Mark reviewed` — unclear why. (Also: that's your own name in the demo dataset; might want to swap for "Sample Lead" before the demo.)

---

## 10. Dealer-style summary — "As a dealer, I felt…"

> "The home page kind of yelled at me. I get it — you revive dead leads — but I don't need it three times in red caps. The safety stuff was actually reassuring; I liked that it told me up front that nothing sends until I approve it. But then I uploaded my leads and it said all 20 of them weren't eligible because of missing dates — and the only way to fix it was to re-upload? Then it told me my payment was received but also told me there was no payment on file. The setup bar said 45% in one place and 25% in another. I clicked Campaigns and it said there were no campaigns — but my dashboard had four of them right there. When I went to settings to add my store info, there's no store info to add, just my name. The settings page is white and the rest of the app is black, so it kind of feels like two different apps. I'd be calling support before I'd be running my first campaign. If a buddy asked me 'is this ready?' I'd say it's close but I wouldn't want to be the first one in."

---

## Caveats / scope notes

- Could not test conversation detail, Take Over flow, or Reply/Send flow — inbox is empty pre-launch. Once a campaign is sending, this should be re-audited; that's where the highest-trust moments (and highest-risk buttons) live.
- Did not click `COMPLETE PAYMENT`, did not check the attestation checkboxes, did not approve a campaign, did not send SMS, did not change settings.
- Mobile/narrow-viewport check is approximate — the testing harness resized the window but the captured screenshot continued to render at desktop dimensions; the absence of a visible mobile breakpoint at the test width is suggestive but not conclusive. Worth a manual phone check.

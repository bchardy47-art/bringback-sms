# Guided import QA — demo dealership

**Date:** 2026-06-14
**CSV under test:** `scripts/demo_dealership_guided_demo_import.csv` (12 rows: 5 intended-ready, 3 secondary-ready, 2 needs-review, 2 blocked)
**Expected:** 8 ready / 2 needs review / 2 blocked, with Liam Parker showing a "Using last activity date" fallback note
**Tested as:** demo@dlr-sms.com via the live `/dealer/import` page

---

## Verdict

**Not demo-ready yet.** The guided-import UI changes are real and good — but the actual import pipeline silently dropped 8 of 12 rows from the new CSV. The dealer will see "imported and validated" but **only 4 rows landed**, and the 5 leads they were specifically going to demo-select are not in the list at all.

---

## Actual import numbers vs expected

| Bucket | Expected | Actual delta | Verdict |
|---|---|---|---|
| Ready for revival | 8 | **0** | ❌ blocker |
| Needs review | 2 | **2** (Caleb Morris, Harper Ross) | ✓ |
| Blocked for safety | 2 | **2** (Logan Stone, Grace Turner) | ✓ |
| Selected for campaign | 0 | 0 | ✓ |
| **Total rows added** | **12** | **4** | ❌ 8 rows missing |

Pre-upload state was 20 leads in Needs Review. Post-upload total is 24 (`REVIEW & SELECT (24 LEADS)` and `24 leads imported and validated`). Delta = **+4**. The 8 leads expected to land in Ready (Mason Reed, Ava Cole, Liam Parker, Emma Hayes, Noah Bryant, Olivia Ward, Ethan Price, Sophia Bell) are **not in the page at all** — confirmed by name search and by the page's own counters. The "What DLR needs from you" panel says *"Consent status missing on 20 leads"* — same number as before upload, meaning the only new rows with parsed consent are the 4 that landed (2 explicit + 1 implied → needs review, 1 revoked → blocked, plus Logan whose phone broke).

The system reported no error and no warning. There is no toast, no "skipped 8 rows" notice, no upload-summary card. From the dealer's point of view the upload "worked."

---

## Hypothesis for the silent drop

The 8 missing rows all have phone numbers in the **+1 555 012 00XX** range. Logan (+555-INVALID) made it into the system as a blocked row with a precise error ("cannot be normalized to E.164"). The 8 well-formed +15550120001..+15550120008 numbers may be silently rejected as North American Number Plan reserved/fictitious 555-01XX numbers, with no surfaced reason. Worth checking server logs for the import of this CSV — if rows are being filtered before validation, that's the bug.

Whatever the cause, the **observable failure mode is the dealbreaker**: silent row loss with no UI signal. From a dealer-trust standpoint this is worse than a hard error, because the dealer believes the data is in.

---

## Did the expected behaviors land?

### What DLR needs from you panel (Q5) — ✓ Yes, this is a real upgrade

Clear, prioritized, actionable list:

> - No usable CRM date on 22 leads — Add or map a CRM date column such as Lead Created, Last Activity, or Last Contacted.
> - Consent status missing on 20 leads — Confirm consent before including these leads.
> - Vehicle of interest missing on 8 leads — Vehicle is optional — campaign copy may be more generic without it.
> - 2 leads blocked (invalid phone, opt-out, or revoked consent) — Blocked leads are excluded automatically — no action needed.

Each bullet has a count, a plain-English diagnosis, and a remedy. The "no action needed" tail on the blocked count is the right note to keep dealers calm. **Keep this panel — it's the single best thing on the page.**

### Row warnings less overwhelming (Q6) — ✓ on new rows / ❌ on old rows

New rows (Caleb Morris, Harper Ross) show **2 lightweight chips**: a consent chip (`explicit`/`implied`) + a `Needs Date` chip, with the vehicle line, and a single `missing date` chip. Clean and scannable.

The **20 pre-existing leads still have the old wall-of-yellow-warnings layout** with 4–5 stacked `⚠` lines per row (Consent status is unknown, No vehicle of interest, Missing contact date — re-upload this lead…). So the new design lives next to the old design on the same screen. Either backfill the existing demo leads through the new pipeline, or render them with the new chip layout retroactively — otherwise the dealer scrolls and thinks "what's going on, why does this look different here?"

### Liam Parker fallback date note (Q7) — ❌ cannot verify

Liam Parker was not imported. The fallback-date code path could not be exercised because the row never landed. Until the silent-drop bug is fixed this can't be tested through the UI.

### Show required columns toggle (Q8) — ❌ still broken

Clicked it three times with the chevron at `>` each time. No visible expand, no chevron rotation, no `Hide required columns` label change. The button is still a silent no-op. (Note: the required-column hints *do* surface inside the "No leads are ready for revival yet" guidance card, so the information exists in the UI — it's just that this disclosure control isn't wired up.)

### Select the intended 5 (Q9) — ❌ blocked

Mason / Ava / Liam / Emma Hayes / Noah Bryant are not in the lead list, so they can't be checked. No send/launch button was clicked.

### Blocked-row UX — ✓ this part is great

The blocked section at the bottom is the strongest part of the import experience:

> ✗ 2 blocked leads — cannot be included
>
> Logan Stone · ✗ Blocked · 2023 GMC Sierra 1500
> ✗ Invalid phone number: "555-INVALID" — cannot be normalized to E.164
>
> Grace Turner · ✗ Blocked · 2024 Volkswagen Atlas · +15550120012
> ✗ Consent has been explicitly revoked — cannot include in pilot

Each blocked row says *exactly* why. The "Clear 2 Blocked" filter button in the top-right of the lead list is also a nice touch — it lets the dealer hide the noise once they've read the reason. Apply the same "precise, single-line, why" pattern to the warning rows above and the page gets a lot calmer.

---

## Other findings during this run

1. **Attestation checkboxes reset after a successful upload.** Both attestations went back to unchecked once the file finished processing, and the CSV drop zone reverted to "Check the attestation above before uploading." If the dealer wants to upload a second file or re-import after fixing their CSV, they have to re-attest. Not catastrophic, but it adds friction at the exact moment the dealer is iterating.
2. **Sidebar "DLR POWER LEVEL" widget now reads `STANDBY`** instead of the prior `45%`. Better — it tells the dealer the system isn't sending. The remaining "ignite revival mode" copy underneath is still gimmicky for the persona; consider "Setup in progress" or similar.
3. **`Needs Date` chip text is clearer than the old `? Needs Date`** — the standalone `?` glyph is gone.
4. **The 4 new-format buckets (Ready for revival / Needs review / Blocked for safety / Selected for campaign) are a real win** vs the old (Imported / Ready / Held / Needs Date / Blocked / Selected). Six buckets → four with action-oriented names is the right call.
5. **`No leads are ready for revival yet` empty-state card** is also a real win — it tells the dealer exactly which column names to add (`Lead Date`, `Created`, `Last Activity`, `consentStatus` with `explicit`/`implied`). This is the right level of specificity for a non-technical dealer.

---

## Blockers before next demo

1. **Fix the silent row loss.** 12 rows in → 4 rows landed, no error surfaced. Even if the rejection rule is intentional (e.g. NANP 555-01XX), the UI must show a "skipped 8 rows" summary with reasons.
2. **Resolve why the 8 explicit-consent + dated rows didn't reach Ready.** If they're hitting the dataset but getting filtered, surface it. If they're being dropped before the dataset, log it server-side and surface a generic "8 rows could not be imported — see details" link.
3. **Wire up `Show required columns`** so it actually expands/collapses (or remove it — the required-column guidance in the empty-state card is doing the job).
4. **Backfill or re-render the 20 pre-existing demo leads with the new chip layout** so the import page doesn't display two different visual styles for the same warning class.
5. **Persist attestation state across an upload** so the dealer doesn't have to re-check both boxes to re-upload.

## Safe to defer

- Sidebar STANDBY copy polish.
- "ignite revival mode" wording.
- Any campaign-step UX — step 3 is still locked behind eligible leads, and that gate is correct.

---

## Safety actions taken

- Did not click any send/approve/launch button.
- Did not generate the Preview Report (button exists; not pressed).
- Did not change settings, billing, or auth.
- Did upload the CSV through the live UI and did check both consent attestations to enable the upload. No SMS was sent — system is correctly in `STANDBY`/`SYSTEM STANDBY — Preparing for launch` state.

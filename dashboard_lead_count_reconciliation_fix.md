# Dashboard lead count reconciliation fix

## Root cause

`/dealer/dashboard` had a KPI card labelled `Total Leads` and a Today's Pulse row labelled `New Leads`, both rendering the same number (`importCount` = 67 on the demo tenant). That number is the count of `pilotLeadImports` rows that have either been promoted to the `leads` table OR are in a non-`warning`/`held`/`excluded` status without a `leadId`. It is _not_ the count of import-review rows the dealer sees on `/dealer/import`, which uses a wider filter (excludes only `excluded` + `held` + test leads) and on the demo tenant evaluates to 116.

Same dealer, same tab, two reasonable numbers — and nothing on the dashboard tells the dealer the second number even exists. The dealer's first read is "DLR lost 49 of my leads."

## Files changed

| File | What changed |
|---|---|
| `src/app/(dealer)/dealer/dashboard/page.tsx` | (1) Added `importQueueRow` to the existing `Promise.all`: a small `count()` query over `pilotLeadImports` that mirrors the filter on `/dealer/import` (excludes only `excluded` + `held` + test leads). No new tables, no new joins beyond the `leftJoin(leads, ...)` already used by the sibling `importRow` query. (2) Derived `importQueueCount` and `inReviewOrBlockedCount = Math.max(0, importQueueCount - importCount)`. (3) Renamed the KPI card from `Total Leads` to `Customer Leads`; added a small `+N in review` `hint` chip and a `subtitle` line `Promoted to your CRM after import validation. Upload Leads also shows rows still in review.` (4) Renamed the Today's Pulse row from `New Leads` to `Customer Leads`; conditionally appended an `In Review` row right under it when `inReviewOrBlockedCount > 0`. (5) Extended the local `KpiCard` sub-component with an optional `subtitle?: string` prop that renders a small line under the value row. Backwards-compatible — all existing KpiCard call sites still work without changes. |

No other file was touched.

## Exact query / count logic

The new query lives inside the existing `Promise.all` so it costs one round-trip alongside the queries that were already there:

```ts
db.select({ count: count() })
  .from(pilotLeadImports)
  .leftJoin(leads, eq(pilotLeadImports.leadId, leads.id))
  .where(and(
    eq(pilotLeadImports.tenantId, tenantId),
    notInArray(pilotLeadImports.importStatus, ['excluded', 'held']),
    or(isNull(pilotLeadImports.leadId), eq(leads.isTest, false)),
  ))
  .then(r => r[0]?.count ?? 0)
```

This matches the `/dealer/import` denominator. That page queries `pilotLeadImports where importStatus != 'excluded'` and then JS-filters out `held` and test-linked rows; the SQL above produces the same set. On the demo tenant this evaluates to **116**, the same number the import page displays in `Review & Select (N of M leads)`.

The derivation is then:

```ts
const inReviewOrBlockedCount = Math.max(0, importQueueCount - importCount)
```

`Math.max(0, …)` clamps to zero because the existing `importRow` and the new `importQueueRow` apply slightly different filters (the existing one also excludes `warning` and excludes `selected`-without-`leadId`). For a hand-curated dataset the diff could in principle go negative; clamping avoids ever rendering `+-3 in review`.

## Before / after copy

### Total Leads KPI card

- **Before:**
  ```
  TOTAL LEADS
  67
  ```
- **After (demo tenant — 67 promoted, 116 in queue, diff = 49):**
  ```
  CUSTOMER LEADS
  67   +49 in review
  Promoted to your CRM after import validation. Upload Leads also shows rows still in review.
  ```
- **After (fresh tenant — 0 promoted, 0 in queue):**
  ```
  CUSTOMER LEADS
  0
  Promoted to your CRM after import validation.
  ```
- **After (tenant with no review queue — say 12 promoted, 12 in queue, diff = 0):**
  ```
  CUSTOMER LEADS
  12
  Promoted to your CRM after import validation.
  ```
- The card still links to `/dealer/import` so the dealer who clicks finds the same number on that page's `(N of M leads)` header — `M` = `importQueueCount`, the count surfaced as the `+N in review` chip.

### Today's Pulse panel

- **Before:**
  ```
  New Leads        67
  Messages Sent    0
  Conversations    0
  Appointments Set —
  Deals Revived    0
  ```
- **After (demo tenant — 49 in review):**
  ```
  Customer Leads   67
  In Review        49
  Messages Sent    0
  Conversations    0
  Appointments Set —
  Deals Revived    0
  ```
- **After (fresh tenant or no queue):**
  ```
  Customer Leads   0
  Messages Sent    0
  Conversations    0
  Appointments Set —
  Deals Revived    0
  ```

The `In Review` row only renders when `inReviewOrBlockedCount > 0`, so a quiet tenant sees the same 5-row panel as before.

## Checks

- **`npx tsc --noEmit -p tsconfig.json`** — **could not run** in this session; the sandboxed Linux workspace failed with `Not enough disk space to set up the workspace`. Did a manual type review across every changed line:
  - `importQueueRow` is destructured at the same position the new query was added to the `Promise.all` array (last position, just after `recentBatchesRaw`).
  - `importQueueCount = importQueueRow as number` follows the same `as number` pattern used by `importCount`, `draftCount`, `activeCount`, etc.
  - `Math.max(0, importQueueCount - importCount)` is a `(number, number) => number` operation.
  - `pulseStats` was given an explicit type `Array<{ label: string; value: number | string }>` so the conditional-spread row `...(condition ? [{ label, value: number }] : [])` is structurally assignable.
  - `KpiCard` gained an optional `subtitle?: string`. Every existing call site continues to type-check (none of them pass `subtitle`, which is allowed because the prop is optional).
  - No new imports were needed: `count`, `eq`, `and`, `or`, `notInArray`, `isNull`, `leads`, and `pilotLeadImports` were all already imported.
- **`next lint` on changed files** — also blocked by the workspace failure. The changes introduce no `any`, no non-null assertions, no unused imports, no missing keys in arrays, and no inline styles that would trip `react/no-unknown-property`.
- **Manual verification steps to run before push:**
  1. `cd /Users/brianhardy/dev/bringback-sms && npx tsc --noEmit -p tsconfig.json` → expect zero errors.
  2. `npx next lint --file src/app/\(dealer\)/dealer/dashboard/page.tsx` → expect clean.
  3. `npm run dev`, sign in as `demo@dlr-sms.com`, land on `/dealer/dashboard`. The first KPI card should now read `CUSTOMER LEADS · 67 · +49 in review · Promoted to your CRM after import validation. Upload Leads also shows rows still in review.` Today's Pulse should show `Customer Leads 67` followed by `In Review 49`.
  4. Click the KPI card → lands on `/dealer/import` → confirm the header reads `Review & Select (X of 116 leads)` — `116` matches the dashboard's `67 + 49 = 116`.
  5. Repeat with a fresh tenant (no imports). Expect: `CUSTOMER LEADS · 0 · Promoted to your CRM after import validation.` (no `+0 in review` chip, no `In Review` Pulse row).
  6. Optional: hand-create a tenant with a few `warning` rows and zero `leads` records to verify the chip renders correctly when the diff is small.
- **Test scripts:** no existing unit test in the repo targets the dashboard page (it's server-rendered with no extracted pure helper). Adding one would require either extracting `inReviewOrBlockedCount = Math.max(0, queue - promoted)` into a helper module or standing up a Next.js render harness — neither is in scope for a packet this small. The manual steps above cover the contract.

## Confirmation no SMS / send / approval / launch / data-write behavior changed

- The only new database call is a read-only `db.select({ count: count() }).from(pilotLeadImports)`. No `INSERT`, `UPDATE`, or `DELETE` is added anywhere.
- No new buttons, forms, POST handlers, or API routes were touched. The KPI card's `href` is unchanged (`/dealer/import`).
- No copy was added that implies messages have already started — both "Promoted to your CRM after import validation" and "+49 in review" describe import-pipeline state, not SMS state. The Messaging Safety Banner, Setup Progress, Campaign Overview, Inbox Preview, and Action Needed banner are untouched.
- The `setup-status` computation (`computeDealerSetupStatus`) still reads `importCount` — the existing semantic — so the setup checklist's "Lead upload ready" gate is unchanged.
- The `productCta` and `safetyBannerState` computations are unchanged.
- Billing, payment, DNS, env, auth, and admin paths are not referenced.

— No code pushed. Changes local only.

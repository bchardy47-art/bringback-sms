# Dealer Import Flow

How a dealer imports leads, classifies them by age, and lands them in
draft pilot batches with previews already populated — all without
admin involvement.

## Routes the dealer touches

The entire flow lives behind the `(dealer)` route group, gated to
`role='dealer'` at three layers:

  * **Middleware** (`src/middleware.ts`) — `/dealer/**` redirects
    non-dealers to `/dashboard` or `/login`.
  * **Layout** (`src/app/(dealer)/layout.tsx`) — defense-in-depth
    `if (session.user.role !== 'dealer') redirect('/dashboard')`.
  * **API routes** (`src/app/api/dealer/pilot-leads/**`) —
    `requireDealer()` from `src/lib/api/requireAuth.ts`, with
    `tenantId` derived from session.

The dealer page UI lives at `/dealer/import`.

## The end-to-end flow

1. **Dealer lands on `/dealer/import`.** The page is a server component
   that loads the dealer's current `pilot_lead_imports` rows and renders
   the shared `ImportForm` + `LeadReviewControls` components. Every
   component instance receives `apiBase="/api/dealer/pilot-leads"` — so
   the same code that powers the admin pilot-leads page targets dealer-
   side routes when used here.

2. **Dealer imports leads.** Either:
     * Paste CSV (column aliases recognised: `contactDate`,
       `first_contact`, `inquiry_date`, etc. — see
       `src/lib/pilot/age-classification.ts`)
     * Manual single-row form
   The TCPA attestation checkbox must be ticked before submit.
   The form POSTs to `POST /api/dealer/pilot-leads/import`.

3. **Server-side classification.** `importLeads()` runs each row through:
     * `validateImportRow()` — phone normalisation, opt-out check,
       intra-session dedup, existing-lead lookup, consent gate.
     * `classifyLeadAge()` — bucket assignment from `contact_date`.
       Leads aged <14 days become `import_status='held'` with
       `enrollAfter = contactDate + 14d`. Leads 14-29 days → bucket A,
       30-59 → B, 60-89 → C, 90+ → D. Each bucket maps to the
       pre-seeded tenant workflow with that `ageBucket`.
   Result: `pilot_lead_imports` rows with `import_status` ∈
   {eligible, warning, blocked, held}, `age_bucket`,
   `assigned_workflow_id` set.

4. **Auto-select eligible.** `<AutoSelectEligible />` POSTs once on
   first page load to `POST /api/dealer/pilot-leads/select-all-eligible`
   so eligible rows are promoted to `selected` without manual clicking.

5. **Dealer reviews and creates a batch.** Clicking
   "Create Recommended Pilot" POSTs to `POST /api/dealer/pilot-leads/
   create-batch`. The endpoint:
     a. Calls `createBucketsFromImport()` — one draft `pilot_batches`
        row per `age_bucket` represented in the selected leads.
     b. Calls `runBatchPreview()` for each batch (in parallel,
        each in its own try/catch — a single batch's preview
        failure can't poison the others). Preview generation
        writes `preview_messages` + `eligibility_result` +
        `approved_for_send` + `send_status='pending'` to each
        `pilot_batch_leads` row, and advances batch status to
        `previewed`.
     c. Response includes `batches[]` (with batch ids + bucket labels +
        lead counts) plus optional `previewWarnings[]` if any preview
        run failed.

6. **Dealer reviews each draft batch.** The dealer can open
   `/dealer/batches/[batchId]` and see fully-rendered message previews
   without any admin needing to click "Run Dry-Run Preview".

## What CANNOT happen via this flow

  * **No live send.** Every batch lands at `status='previewed'`, never
    `sending`. Sends require explicit admin approval + readiness gates
    (see `live-pilot` + `first-pilot` flows).
  * **No cross-tenant leakage.** All endpoints derive `tenantId` from
    session. Dealer cannot touch another tenant's data even by
    submitting another tenant's `importIds` in the body.
  * **No admin-route hits.** The dealer page resolves every fetch
    through `apiBase='/api/dealer/pilot-leads'`; admin routes
    (`/api/admin/dlr/pilot-leads/**`) stay locked to `requireAdmin()`
    and return 403 if a dealer ever hits one directly.

## Why dealer/admin shells share lib functions

The route shells under `/api/admin/dlr/pilot-leads/**` and
`/api/dealer/pilot-leads/**` are thin, role-gated wrappers around the
same lib functions:

```
importLeads, importLeadsFromCSV         (lib/pilot/lead-import)
setLeadSelected, excludeImportedLead    (lib/pilot/lead-import)
createBucketsFromImport, createPilot…   (lib/pilot/lead-import)
bulkClearBlocked, generateDryRunReport, (lib/pilot/lead-import-review)
updateImportedLead, markReviewed
runBatchPreview                          (lib/pilot/preview)
```

Each lib helper takes `tenantId` as a parameter and writes scoped
queries. The route shells only differ in who's allowed to call them.
A future "dealer-only" or "admin-only" feature added to either shell
won't bleed across.

## Commits

  * `50c391b` — dealer mirror routes + `requireDealer()` helper +
    `apiBase` prop on shared client components
  * `6188a5a` — auto-preview-on-create (applies to both admin and
    dealer create-batch surfaces)
  * `862ca66` — age-bucket classification (drives bucket assignment
    during import)
  * `b729314` — pilot-leads UI cluster (admin)
  * `7134c18` — admin pilot-leads API RBAC tightening

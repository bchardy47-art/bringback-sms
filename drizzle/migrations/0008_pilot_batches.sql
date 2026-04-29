-- Phase 9: Controlled Pilot Mode
--
-- Creates two tables for managing small, manually-approved pilot batches:
--
--   pilot_batches      — one row per pilot run (workflow + tenant + status)
--   pilot_batch_leads  — one row per lead in a batch (eligibility, preview, send tracking)
--
-- No auto-enrollment ever touches these tables. All enrollments in a pilot
-- are created explicitly when an admin starts the batch after approval.

-- ── pilot_batches ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pilot_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id      UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,

  -- Lifecycle state
  -- draft       → previewed → approved → sending → completed
  --                                              ↘ paused → sending (resume)
  --                                              ↘ cancelled
  status           TEXT NOT NULL DEFAULT 'draft',

  -- Hard cap on how many leads this batch can contain (enforced at creation)
  max_lead_count   INTEGER NOT NULL DEFAULT 10,

  -- Audit fields
  created_by       TEXT NOT NULL,
  approved_by      TEXT,
  approved_at      TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,

  -- Dry-run summary stored as JSONB after /preview runs
  -- Shape: { leads: [{ leadId, firstName, lastName, eligible, messages: [...], skipReason? }] }
  dry_run_summary  JSONB,

  -- Running counters (updated as sends/replies happen)
  live_send_count  INTEGER NOT NULL DEFAULT 0,
  blocked_count    INTEGER NOT NULL DEFAULT 0,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  handoff_count    INTEGER NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pilot_batches_tenant_status_idx
  ON pilot_batches (tenant_id, status, created_at DESC);

-- ── pilot_batch_leads ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pilot_batch_leads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id             UUID NOT NULL REFERENCES pilot_batches(id) ON DELETE CASCADE,
  lead_id              UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  -- Result from eligibility check at preview time
  -- Shape: { eligible: boolean, reason?: string, checks: [...] }
  eligibility_result   JSONB,

  -- Rendered message previews for this lead (populated during /preview)
  -- Shape: [{ position, type, rendered, usedFallback, delayHours }]
  preview_messages     JSONB,

  -- Whether the admin has explicitly approved this lead for live send
  -- (defaults true for eligible leads after batch approval, can be overridden)
  approved_for_send    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Send lifecycle: pending → sent | skipped | cancelled
  send_status          TEXT NOT NULL DEFAULT 'pending',
  skip_reason          TEXT,

  -- Populated from inbound reply handling
  reply_classification TEXT,
  handoff_task_id      UUID REFERENCES handoff_tasks(id) ON DELETE SET NULL,

  -- Set when a workflowEnrollment is created for this lead at batch start
  enrollment_id        UUID REFERENCES workflow_enrollments(id) ON DELETE SET NULL,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One entry per lead per batch
  UNIQUE (batch_id, lead_id)
);

CREATE INDEX IF NOT EXISTS pilot_batch_leads_batch_idx
  ON pilot_batch_leads (batch_id, send_status);

CREATE INDEX IF NOT EXISTS pilot_batch_leads_lead_idx
  ON pilot_batch_leads (lead_id);

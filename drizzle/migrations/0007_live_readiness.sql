-- Phase 8: Live SMS Readiness & Activation Controls
--
-- Adds tenant-level readiness fields and workflow-level activation fields.
-- All new fields default to the safest/most-restricted value so existing rows
-- remain blocked from live sends until explicitly approved.

-- ── Tenant readiness fields ───────────────────────────────────────────────────

ALTER TABLE tenants
  -- Master live-send approval for this dealership (set by DLR admin, not auto)
  ADD COLUMN IF NOT EXISTS sms_live_approved        BOOLEAN NOT NULL DEFAULT FALSE,

  -- 10DLC registration status for this tenant's sending number.
  -- Values: not_started | pending | approved | rejected | exempt | dev_override
  -- 'exempt'       — e.g. toll-free numbers that don't require 10DLC
  -- 'dev_override' — manual bypass for dev/demo tenants (must be documented)
  ADD COLUMN IF NOT EXISTS ten_dlc_status           TEXT NOT NULL DEFAULT 'not_started',

  -- The outbound number used for this tenant. May duplicate phoneNumbers table
  -- but stored here for fast readiness checks without a join.
  ADD COLUMN IF NOT EXISTS sms_sending_number       TEXT,

  -- Hard compliance block — overrides all other flags. No sends while true.
  ADD COLUMN IF NOT EXISTS compliance_blocked       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS compliance_block_reason  TEXT,

  -- When true, every send attempt requires a manual approval step
  -- (reserved for high-risk or trial tenants).
  ADD COLUMN IF NOT EXISTS requires_manual_approval_before_send BOOLEAN NOT NULL DEFAULT FALSE,

  -- Audit: when was live sending enabled, and by whom
  ADD COLUMN IF NOT EXISTS live_activated_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS live_activated_by        TEXT;

-- ── Workflow activation fields ────────────────────────────────────────────────

ALTER TABLE workflows
  -- Explicit human approval that this workflow's message copy is safe for live sends.
  ADD COLUMN IF NOT EXISTS approved_for_live        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by              TEXT,

  -- Compliance enforcement: workflow copy must include opt-out language
  -- (e.g. "Reply STOP to opt out"). Checked at approval time.
  ADD COLUMN IF NOT EXISTS requires_opt_out_language BOOLEAN NOT NULL DEFAULT TRUE,

  -- When true, a human must review a dry-run preview before activation.
  ADD COLUMN IF NOT EXISTS manual_review_required   BOOLEAN NOT NULL DEFAULT FALSE,

  -- Fine-grained lifecycle state for UI progress tracking.
  -- draft          — just created / imported
  -- preview_ready  — dry-run preview has been generated and reviewed
  -- approved       — copy approved by a human (approved_for_live=true)
  -- active         — isActive=true, enrolling leads
  -- paused         — was active, now paused
  ADD COLUMN IF NOT EXISTS activation_status        TEXT NOT NULL DEFAULT 'draft';

-- ── Index for compliance checks ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS tenants_compliance_idx
  ON tenants (compliance_blocked, sms_live_approved);

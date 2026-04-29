-- Phase 11: First Live Pilot Runbook
-- Adds first-pilot state machine fields to pilot_batches so a controlled
-- 5-lead smoke-test workflow can be tracked separately from the general
-- pilot batch lifecycle.

ALTER TABLE pilot_batches
  -- Marks this batch as a "first live pilot" — max 5 leads enforced in code.
  ADD COLUMN IF NOT EXISTS is_first_pilot             BOOLEAN NOT NULL DEFAULT FALSE,

  -- Fine-grained state for the smoke-test / remaining-sends lifecycle.
  -- not_started | ready_for_smoke_test | smoke_test_sending | smoke_test_passed
  -- | smoke_test_failed | ready_for_remaining | remaining_sending
  -- | completed | paused | cancelled
  ADD COLUMN IF NOT EXISTS first_pilot_state          TEXT NOT NULL DEFAULT 'not_started',

  -- Which pilot_batch_lead was chosen as the smoke-test subject.
  ADD COLUMN IF NOT EXISTS smoke_test_lead_id         UUID REFERENCES pilot_batch_leads(id) ON DELETE SET NULL,

  -- Timestamps for the smoke-test lifecycle.
  ADD COLUMN IF NOT EXISTS smoke_test_sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS smoke_test_passed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS smoke_test_failed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS smoke_test_fail_reason     TEXT,

  -- When remaining leads were enrolled.
  ADD COLUMN IF NOT EXISTS remaining_started_at       TIMESTAMPTZ,

  -- Set when a STOP or escalation complaint occurs mid-pilot.
  -- Blocks further sends until an admin explicitly confirms continuation.
  ADD COLUMN IF NOT EXISTS continuation_required      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS continuation_reason        TEXT,
  ADD COLUMN IF NOT EXISTS continuation_confirmed_by  TEXT,
  ADD COLUMN IF NOT EXISTS continuation_confirmed_at  TIMESTAMPTZ,

  -- Set by verifySmokeTest: confirms audit row and Telnyx provider ID present.
  ADD COLUMN IF NOT EXISTS audit_row_verified         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provider_id_verified       BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS pilot_batches_first_pilot_idx
  ON pilot_batches (is_first_pilot, first_pilot_state)
  WHERE is_first_pilot = TRUE;

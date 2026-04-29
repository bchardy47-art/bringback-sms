-- Phase 13: Live pilot execution support
-- Adds confirmation gate fields and pilot report storage to pilot_batches.

ALTER TABLE pilot_batches
  -- Confirmation gate: admin must type this phrase + check all boxes before smoke test
  ADD COLUMN IF NOT EXISTS confirmation_phrase      TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_checks      JSONB,      -- PilotConfirmationChecks
  ADD COLUMN IF NOT EXISTS confirmed_by             TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at             TIMESTAMPTZ,

  -- Final pilot report (generated after completion or on demand)
  ADD COLUMN IF NOT EXISTS pilot_report             JSONB;      -- PilotReport

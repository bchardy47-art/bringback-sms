-- Phase 15: Pilot Prep UX + Dry-Run Review
-- Adds review tracking columns to pilot_lead_imports.
-- No existing tables are modified destructively.

ALTER TABLE pilot_lead_imports
  ADD COLUMN IF NOT EXISTS reviewed        BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by     TEXT;

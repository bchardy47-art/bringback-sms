-- Migration 0016: Lead-age bucket classification
-- Phase 16 — auto-assign leads to age-based workflows
--
-- Run on VPS:
--   psql $DATABASE_URL -f migrations/0016_age_bucket_classification.sql
--
-- Safe to run multiple times (all statements use IF NOT EXISTS / DO NOTHING).

-- ── 1. workflows: add ageBucket ───────────────────────────────────────────────

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS age_bucket TEXT;

-- Enforce one bucket workflow per tenant (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS workflows_tenant_age_bucket_unique
  ON workflows (tenant_id, age_bucket)
  WHERE age_bucket IS NOT NULL;

-- ── 2. pilot_lead_imports: add age-classification columns ─────────────────────

ALTER TABLE pilot_lead_imports
  ADD COLUMN IF NOT EXISTS contact_date         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_age_days        INTEGER,
  ADD COLUMN IF NOT EXISTS age_bucket           TEXT,
  ADD COLUMN IF NOT EXISTS enroll_after         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL;

-- ── 3. Indexes ────────────────────────────────────────────────────────────────

-- Bucket + status lookup (used by the import summary query)
CREATE INDEX IF NOT EXISTS pilot_lead_imports_bucket_idx
  ON pilot_lead_imports (tenant_id, age_bucket, import_status);

-- Held-lead sweep: find all held leads whose enrollAfter date has passed
CREATE INDEX IF NOT EXISTS pilot_lead_imports_enroll_after_idx
  ON pilot_lead_imports (enroll_after, import_status)
  WHERE import_status = 'held';

-- ── 4. Comments ───────────────────────────────────────────────────────────────

COMMENT ON COLUMN workflows.age_bucket IS
  'Identifies this as a DLR pilot age-bucket workflow. Values: a=14-29d, b=30-59d, c=60-89d, d=90+d. Null = standard workflow.';

COMMENT ON COLUMN pilot_lead_imports.contact_date IS
  'Canonical day-1 date: dealership''s first contact with the lead. Parsed from CSV; used to compute lead_age_days and age_bucket.';

COMMENT ON COLUMN pilot_lead_imports.lead_age_days IS
  'Days between contact_date and import date. Null if contact_date is missing.';

COMMENT ON COLUMN pilot_lead_imports.age_bucket IS
  'Auto-assigned age bucket. a=14-29d, b=30-59d, c=60-89d, d=90+d. Null if held or needs_review.';

COMMENT ON COLUMN pilot_lead_imports.enroll_after IS
  'For held leads: the date they become eligible for outreach (contact_date + 14 days).';

COMMENT ON COLUMN pilot_lead_imports.assigned_workflow_id IS
  'Workflow auto-assigned by the age-classification logic. Null if no matching bucket workflow found for this tenant.';

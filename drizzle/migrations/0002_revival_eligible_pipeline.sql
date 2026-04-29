-- Migration: Revival-eligible pipeline
-- Adds the revival_eligible lead state and per-tenant automation pause flag.
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction in
-- PostgreSQL. Run this file outside a transaction block, or split it:
--   Step 1 — run the ALTER TYPE line alone
--   Step 2 — run the rest inside a transaction
--
-- With psql: psql $DATABASE_URL -f drizzle/migrations/0002_revival_eligible_pipeline.sql

-- ── 1. Add revival_eligible to the lead_state enum ──────────────────────────
-- Must be outside a transaction. If you use a migration runner that wraps
-- everything in BEGIN/COMMIT, run this line manually first.
ALTER TYPE lead_state ADD VALUE IF NOT EXISTS 'revival_eligible' AFTER 'orphaned';

-- ── 2. Add per-tenant automation pause flag ──────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS automation_paused boolean NOT NULL DEFAULT false;

-- ── 3. Index: fast lookup of revival_eligible leads per tenant ───────────────
CREATE INDEX IF NOT EXISTS leads_revival_eligible_idx
  ON leads (tenant_id)
  WHERE state = 'revival_eligible';

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT unnest(enum_range(NULL::lead_state));  -- should include revival_eligible
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants';

-- Migration: Safety gates for outbound SMS automation
-- Run with: npx drizzle-kit migrate  OR  psql $DATABASE_URL -f this-file.sql

-- ── Leads: safety flag columns ───────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS do_not_automate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_test         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_automated_at timestamptz;

-- ── Messages: per-step-execution idempotency key ─────────────────────────────
-- Ensures a given workflow step execution can only produce one outbound message row.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS step_execution_id uuid
    REFERENCES workflow_step_executions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_step_execution_idx
  ON messages (step_execution_id)
  WHERE step_execution_id IS NOT NULL;

-- ── Helpful partial indexes for fast worker queries ──────────────────────────
CREATE INDEX IF NOT EXISTS leads_do_not_automate_idx
  ON leads (tenant_id)
  WHERE do_not_automate = true;

CREATE INDEX IF NOT EXISTS leads_is_test_idx
  ON leads (tenant_id)
  WHERE is_test = true;

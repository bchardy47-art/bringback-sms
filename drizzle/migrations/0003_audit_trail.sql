-- Migration: Audit trail columns
-- Adds structured suppression/stop/skip reason fields for full observability
-- into why leads were not enrolled or why messages were not sent.
--
-- All columns are nullable text / timestamptz — safe to add to live tables.
-- Run with: psql $DATABASE_URL -f drizzle/migrations/0003_audit_trail.sql

-- ── leads ─────────────────────────────────────────────────────────────────────

-- Set by eligibility agent when a lead is suppressed. Cleared when lead
-- transitions to revival_eligible (passed all checks).
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS suppression_reason text;

-- Set when an inbound message is received from the lead.
-- Used by eligibility agent for recency checks and response classification.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_customer_reply_at timestamptz;

-- Set when a human (manager or agent) sends a message manually from the inbox.
-- Helps distinguish human-initiated contact from automated touches.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_human_contact_at timestamptz;

-- ── workflow_enrollments ──────────────────────────────────────────────────────

-- Why the enrollment ended (stop_condition, opted_out, completed, cancelled, etc.)
ALTER TABLE workflow_enrollments
  ADD COLUMN IF NOT EXISTS stop_reason text;

-- When the enrollment stopped (mirrors completed_at for terminal states,
-- but also populated for mid-sequence stops so we have a clear timestamp).
ALTER TABLE workflow_enrollments
  ADD COLUMN IF NOT EXISTS stopped_at timestamptz;

-- ── messages ─────────────────────────────────────────────────────────────────

-- Why the message was not sent (sms_not_live, dry_run, opted_out, etc.)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS skip_reason text;

-- When the skip decision was recorded.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS skipped_at timestamptz;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name IN ('leads', 'workflow_enrollments', 'messages')
--   AND column_name IN (
--     'suppression_reason', 'last_customer_reply_at', 'last_human_contact_at',
--     'stop_reason', 'stopped_at', 'skip_reason', 'skipped_at'
--   )
--   ORDER BY table_name, column_name;

-- 0021_backfill_undated_imports.sql
--
-- One-time backfill for pilot_lead_imports rows that landed on prod BEFORE
-- the age-classification logic (committed in 862ca66) was wired into the
-- import path. Those legacy rows are stuck at import_status='eligible'
-- with contact_date IS NULL — they would otherwise be selectable for a
-- batch with no ageBucket / assignedWorkflowId, defeating the Phase 16
-- bucket-based batch creation.
--
-- New imports under the current code path already promote 'eligible' →
-- 'warning' when contact_date is unparseable, and add the corresponding
-- operator-visible warning. This migration brings the same state to the
-- legacy rows.
--
-- Idempotent: the WHERE clause stops matching once a row's status is
-- 'warning', so re-running is a no-op. No schema change, no row deletion,
-- no FK touched.

UPDATE pilot_lead_imports
SET
  import_status = 'warning',
  warnings = COALESCE(warnings, '[]'::jsonb) || jsonb_build_array(
    'Contact date missing — imported before age classification was wired. '
    || 'Re-import this lead or set its contact date before sending.'
  ),
  updated_at = now()
WHERE contact_date IS NULL
  AND import_status = 'eligible';

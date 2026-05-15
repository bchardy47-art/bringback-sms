-- Phase 5b: Automotive intelligence columns on handoff_tasks
--
-- heat_score:        'hot' | 'warm' | NULL (NULL for escalations or unknown)
-- sales_summary:     short fact-only template-built string for the human agent
-- automotive_signals: full AutomotiveSignals JSON for audit and future analytics
--
-- All columns nullable so existing rows are unaffected.

ALTER TABLE handoff_tasks
  ADD COLUMN IF NOT EXISTS heat_score        text,
  ADD COLUMN IF NOT EXISTS sales_summary     text,
  ADD COLUMN IF NOT EXISTS automotive_signals jsonb;

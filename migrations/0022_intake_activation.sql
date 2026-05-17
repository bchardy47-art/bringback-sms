-- Phase 21: Split intake into Stage 1 (activation/close) + Stage 2 (full onboarding).
-- Adds the three columns the activation flow needs.

ALTER TABLE dealer_intakes
  ADD COLUMN IF NOT EXISTS activated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS plan         text,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';

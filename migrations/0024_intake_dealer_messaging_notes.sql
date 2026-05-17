-- Phase 22: optional free-text messaging notes from Stage 2.
-- Set by dealers who uncheck "Use recommended starter messaging" and
-- want to convey custom intent for ops to read pre-launch. Nullable;
-- the common path leaves the recommended-messaging default in place.

ALTER TABLE dealer_intakes
  ADD COLUMN IF NOT EXISTS dealer_messaging_notes text;

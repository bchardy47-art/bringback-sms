-- Phase 23: operator-captured 10DLC submission reference.
-- Set when an admin marks the 10dlc_submitted checklist step done from
-- /admin/dlr/intakes/[intakeId]. Usually a TCR campaign ID (e.g.
-- CMP-XXXXXXXX) or brand ID, but free-text — could be a short note like
-- "submitted via Telnyx portal, awaiting brand approval". Nullable;
-- operators can mark the step submitted without a reference.

ALTER TABLE dealer_intakes
  ADD COLUMN IF NOT EXISTS ten_dlc_reference text;

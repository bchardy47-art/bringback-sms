-- Phase 4: reply classification fields on leads
--
-- lastCustomerReplyAt already exists (Phase 2) and serves as the canonical
-- "last reply at" timestamp used by both the send-guard and the classifier.
--
-- New fields:
--   last_reply_body              — truncated body of the most recent inbound message
--   reply_classification         — classified intent (interested, wrong_number, etc.)
--   reply_classification_reason  — matched keyword/rule for audit trail
--   needs_human_handoff          — true for warm/hot leads needing human follow-up

ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_reply_body text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reply_classification text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reply_classification_reason text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_human_handoff boolean NOT NULL DEFAULT false;

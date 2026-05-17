-- Phase 22: legal-acceptance audit trail + Stripe linkage on dealer_intakes.

ALTER TABLE dealer_intakes
  ADD COLUMN IF NOT EXISTS terms_accepted_at         timestamp with time zone,
  ADD COLUMN IF NOT EXISTS terms_version             text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id        text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id    text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;

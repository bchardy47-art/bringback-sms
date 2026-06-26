-- Phase 18: Outreach email lifecycle events from Resend webhooks
--
-- Stores append-only delivery/open/click/bounce/complaint/failure callbacks
-- for dealer outreach emails. Best-effort matched back to outreach_sends.

CREATE TABLE IF NOT EXISTS outreach_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,
  event_type text NOT NULL,
  provider_event_id text,
  resend_email_id text,
  to_email text,
  subject text,
  outreach_send_id uuid,
  raw_payload jsonb NOT NULL,
  occurred_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_email_events_provider_event_idx
  ON outreach_email_events (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS outreach_email_events_resend_email_idx
  ON outreach_email_events (resend_email_id);

CREATE INDEX IF NOT EXISTS outreach_email_events_send_idx
  ON outreach_email_events (outreach_send_id);

CREATE INDEX IF NOT EXISTS outreach_email_events_created_idx
  ON outreach_email_events (created_at);

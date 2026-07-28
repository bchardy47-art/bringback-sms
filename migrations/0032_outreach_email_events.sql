-- Outreach email delivery/engagement events from Resend webhooks.
--
-- Append-only log of every provider event (sent, delivered, delivery_delayed,
-- opened, clicked, bounced, complained, failed) with its raw payload. The DLR
-- webhook handler (src/lib/outreach/resend-webhook.ts) inserts one row per
-- event. This table backs open/click tracking for outreach.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS so partial reruns are safe.
-- Matches src/lib/db/schema.ts `outreachEmailEvents` exactly.

CREATE TABLE IF NOT EXISTS "outreach_email_events" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "provider"           text NOT NULL,
  "event_type"         text NOT NULL,
  "provider_event_id"  text,
  "resend_email_id"    text,
  "to_email"           text,
  "subject"            text,
  "outreach_send_id"   uuid,
  "raw_payload"        jsonb NOT NULL,
  "occurred_at"        timestamp with time zone
);

-- Idempotency key: at most one row per (provider, provider_event_id).
-- (Postgres treats NULLs as distinct, matching the handler which only dedupes
--  when provider_event_id is present.)
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_email_events_provider_event_idx"
  ON "outreach_email_events" ("provider", "provider_event_id");

CREATE INDEX IF NOT EXISTS "outreach_email_events_resend_email_idx"
  ON "outreach_email_events" ("resend_email_id");

CREATE INDEX IF NOT EXISTS "outreach_email_events_send_idx"
  ON "outreach_email_events" ("outreach_send_id");

CREATE INDEX IF NOT EXISTS "outreach_email_events_created_idx"
  ON "outreach_email_events" ("created_at");

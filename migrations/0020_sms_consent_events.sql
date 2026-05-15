-- 0020_sms_consent_events.sql
--
-- Append-only audit table for web-form / API-captured SMS opt-in consent.
-- Used to prove consent to carriers (10DLC) and for TCPA defense.
-- Rows are never updated or deleted; revocations land in opt_outs instead.

CREATE TABLE IF NOT EXISTS sms_consent_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id               uuid REFERENCES leads(id) ON DELETE SET NULL,
  phone                 text NOT NULL,
  first_name            text,
  last_name             text,
  email                 text,
  vehicle_of_interest   text,
  source                text NOT NULL DEFAULT 'web_form',
  consent_text_version  text NOT NULL,
  consent_text_snapshot text NOT NULL,
  ip_address            text,
  user_agent            text,
  page_url              text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_consent_events_tenant_phone_idx
  ON sms_consent_events (tenant_id, phone);

CREATE INDEX IF NOT EXISTS sms_consent_events_created_idx
  ON sms_consent_events (created_at);

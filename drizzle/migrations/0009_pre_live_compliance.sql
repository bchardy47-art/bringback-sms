-- Phase 10: Pre-Live Compliance + Telnyx/10DLC Readiness
-- Adds Telnyx/10DLC detail fields to tenants, and consent/source-tracking
-- fields to leads. SendSmsConfig.optOutFooter is stored in JSONB (no DDL change).

-- ── Tenant: Telnyx / 10DLC detail ───────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS brand_status              TEXT,
  ADD COLUMN IF NOT EXISTS campaign_status           TEXT,
  ADD COLUMN IF NOT EXISTS messaging_profile_id      TEXT,
  ADD COLUMN IF NOT EXISTS campaign_id               TEXT,
  ADD COLUMN IF NOT EXISTS ten_dlc_status_notes      TEXT,
  ADD COLUMN IF NOT EXISTS ten_dlc_approved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ten_dlc_rejected_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ten_dlc_rejection_reason  TEXT;

-- ── Lead: Consent / source tracking ────────────────────────────────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS consent_status       TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS consent_source       TEXT,
  ADD COLUMN IF NOT EXISTS consent_captured_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_inquiry_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_consent_notes    TEXT;

CREATE INDEX IF NOT EXISTS leads_consent_status_idx
  ON leads (tenant_id, consent_status);

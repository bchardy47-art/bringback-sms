-- Phase 12: 10DLC submission fields + production readiness
-- Adds the compliance and submission data needed for Telnyx/TCR brand & campaign registration.

ALTER TABLE tenants
  -- Business identity (TCR brand registration)
  ADD COLUMN IF NOT EXISTS business_legal_name    TEXT,
  ADD COLUMN IF NOT EXISTS ein                    TEXT,          -- EIN/Tax ID (never logged in plaintext; stored for submission only)
  ADD COLUMN IF NOT EXISTS business_address       TEXT,
  ADD COLUMN IF NOT EXISTS business_website       TEXT,

  -- Compliance copy URLs (required for 10DLC + TCR submission)
  ADD COLUMN IF NOT EXISTS privacy_policy_url     TEXT,
  ADD COLUMN IF NOT EXISTS terms_url              TEXT,
  ADD COLUMN IF NOT EXISTS sms_terms_url          TEXT,          -- SMS-specific terms (can match terms_url)

  -- TCR campaign use-case fields
  ADD COLUMN IF NOT EXISTS brand_use_case         TEXT,          -- e.g. 'MIXED', 'MARKETING', '2FA'
  ADD COLUMN IF NOT EXISTS campaign_use_case      TEXT,          -- free-text description for TCR submission

  -- Sample messages stored for 10DLC submission (array of strings)
  ADD COLUMN IF NOT EXISTS ten_dlc_sample_messages JSONB,

  -- Volume and consent
  ADD COLUMN IF NOT EXISTS expected_monthly_volume INTEGER,
  ADD COLUMN IF NOT EXISTS consent_explanation     TEXT,
  ADD COLUMN IF NOT EXISTS lead_source_explanation TEXT;

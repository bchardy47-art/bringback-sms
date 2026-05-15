-- Migration: 0002_tenants_phase12
-- Adds Phase 10 + Phase 12 columns to the tenants table.
-- Uses ADD COLUMN IF NOT EXISTS so it is safe to re-run.

-- Phase 10: Telnyx / 10DLC detail columns
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "brand_status"          text,
  ADD COLUMN IF NOT EXISTS "campaign_status"        text,
  ADD COLUMN IF NOT EXISTS "messaging_profile_id"   text,
  ADD COLUMN IF NOT EXISTS "campaign_id"            text,
  ADD COLUMN IF NOT EXISTS "ten_dlc_status_notes"   text,
  ADD COLUMN IF NOT EXISTS "ten_dlc_approved_at"    timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "ten_dlc_rejected_at"    timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "ten_dlc_rejection_reason" text;

-- Phase 12: Business identity + 10DLC submission fields
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "business_legal_name"     text,
  ADD COLUMN IF NOT EXISTS "ein"                     text,
  ADD COLUMN IF NOT EXISTS "business_address"        text,
  ADD COLUMN IF NOT EXISTS "business_website"        text,
  ADD COLUMN IF NOT EXISTS "privacy_policy_url"      text,
  ADD COLUMN IF NOT EXISTS "terms_url"               text,
  ADD COLUMN IF NOT EXISTS "sms_terms_url"           text,
  ADD COLUMN IF NOT EXISTS "brand_use_case"          text,
  ADD COLUMN IF NOT EXISTS "campaign_use_case"       text,
  ADD COLUMN IF NOT EXISTS "ten_dlc_sample_messages" jsonb,
  ADD COLUMN IF NOT EXISTS "expected_monthly_volume" integer,
  ADD COLUMN IF NOT EXISTS "consent_explanation"     text,
  ADD COLUMN IF NOT EXISTS "lead_source_explanation" text;

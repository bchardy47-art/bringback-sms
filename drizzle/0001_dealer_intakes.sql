-- Migration: 0001_dealer_intakes
-- Run on VPS: psql $DATABASE_URL < drizzle/0001_dealer_intakes.sql

CREATE TABLE IF NOT EXISTS "dealer_intakes" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token"                   text NOT NULL,
  "tenant_id"               uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
  "launch_status"           text NOT NULL DEFAULT 'submitted',

  -- Business identity
  "dealership_name"         text,
  "business_legal_name"     text,
  "ein"                     text,
  "business_website"        text,
  "business_address"        text,

  -- Contacts
  "primary_contact_name"    text,
  "primary_contact_email"   text,
  "primary_contact_phone"   text,
  "sales_manager_name"      text,
  "alert_email"             text,
  "alert_phone"             text,

  -- Operations
  "store_phone"             text,
  "timezone"                text,
  "business_hours"          text,
  "crm_system"              text,

  -- Compliance
  "lead_source_explanation" text,
  "consent_explanation"     text,
  "expected_monthly_volume" integer,

  -- Campaign
  "preferred_workflow_types" jsonb,
  "sample_message_1"        text,
  "sample_message_2"        text,

  -- Agreements
  "approved_sender_name"    text,
  "template_review_agreed"  boolean NOT NULL DEFAULT false,
  "compliance_agreed"       boolean NOT NULL DEFAULT false,

  -- Admin
  "admin_notes"             text,
  "submitted_at"            timestamp with time zone,
  "provisioned_at"          timestamp with time zone,
  "provisioned_by"          text,

  "created_at"              timestamp NOT NULL DEFAULT now(),
  "updated_at"              timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "dealer_intakes_token_idx"
  ON "dealer_intakes"("token");

CREATE INDEX IF NOT EXISTS "dealer_intakes_status_idx"
  ON "dealer_intakes"("launch_status", "created_at");

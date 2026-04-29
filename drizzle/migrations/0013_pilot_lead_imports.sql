-- Phase 14: Pilot Lead Import + Selection
-- Creates a staging table for imported pilot leads.
-- Imported leads are validated here before being promoted to the leads table
-- when a pilot batch is created. No enrollments or sends occur at import time.

CREATE TABLE IF NOT EXISTS pilot_lead_imports (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Raw input (as entered or parsed from CSV)
  first_name            TEXT        NOT NULL,
  last_name             TEXT        NOT NULL,
  phone_raw             TEXT        NOT NULL,          -- original phone string before normalization
  phone                 TEXT,                           -- E.164 normalized (+1XXXXXXXXXX), null if invalid
  email                 TEXT,
  vehicle_of_interest   TEXT,
  lead_source           TEXT,
  original_inquiry_at   TIMESTAMPTZ,
  consent_status        TEXT        NOT NULL DEFAULT 'unknown',  -- explicit | implied | unknown | revoked
  consent_source        TEXT,
  consent_captured_at   TIMESTAMPTZ,
  sms_consent_notes     TEXT,
  crm_source            TEXT        DEFAULT 'manual',
  external_id           TEXT,
  notes                 TEXT,

  -- Validation / import results
  import_status         TEXT        NOT NULL DEFAULT 'pending', -- pending | eligible | blocked | warning | selected | excluded
  blocked_reasons       JSONB,                          -- string[] — hard blocks
  warnings              JSONB,                          -- string[] — soft issues that don't block selection

  -- Deduplication
  duplicate_of_lead_id   UUID,                          -- existing leads.id with same phone or email
  duplicate_of_import_id UUID,                          -- earlier pilot_lead_imports.id in same session

  -- Promotion state (set when batch is created)
  lead_id               UUID        REFERENCES leads(id) ON DELETE SET NULL,

  -- Selection for batch (admin-controlled)
  selected_for_batch    BOOLEAN     NOT NULL DEFAULT false,

  -- Preview data (rendered after import or on demand)
  preview_messages      JSONB,                          -- PilotPreviewMessage[]
  eligibility_result    JSONB,                          -- PilotEligibilityResult

  -- Session tracking
  imported_by           TEXT,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pilot_lead_imports_tenant_idx
  ON pilot_lead_imports (tenant_id, import_status, created_at);

CREATE INDEX IF NOT EXISTS pilot_lead_imports_phone_idx
  ON pilot_lead_imports (tenant_id, phone);

-- Migration: dealer_invites table
-- One-time invite tokens for dealer account creation.

CREATE TABLE IF NOT EXISTS dealer_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  email      TEXT,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  used_by    UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dealer_invites_tenant_id_idx ON dealer_invites (tenant_id);
CREATE INDEX IF NOT EXISTS dealer_invites_token_idx ON dealer_invites (token);

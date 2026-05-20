-- 0026_compliance_attestations.sql
--
-- C-2: Compliance attestations audit table.
--
-- Append-only record of dealer-facing compliance gates:
--   - 'lead_upload_certification' — dealer ticked the consent attestation
--     before submitting a CSV import. resource_id is a synthetic uploadId
--     (UUID minted at request time) since pilot_lead_imports has no
--     per-upload grouping column today.
--   - 'campaign_launch_approval'  — dealer ticked the approval attestation
--     before approving a pilot batch. resource_id is pilot_batches.id.
--
-- Strict-write policy at call sites: if INSERT fails the upstream action
-- aborts. The audit trail is mandatory.
--
-- Polymorphic single-table layout chosen over per-type tables so legal
-- discovery is a single query and new event types don't proliferate tables.
-- Per-type-only fields (file_name, lead_count, message_template_version)
-- are nullable.

CREATE TABLE IF NOT EXISTS compliance_attestations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                  uuid REFERENCES users(id) ON DELETE SET NULL,
  type                     text NOT NULL,
  resource_type            text NOT NULL,
  resource_id              text NOT NULL,
  text_version             text NOT NULL,
  attestation_text         text NOT NULL,
  file_name                text,
  lead_count               integer,
  message_template_version text,
  ip_address               text,
  user_agent               text,
  metadata                 jsonb,
  created_at               timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compliance_attestations_tenant_created_idx
  ON compliance_attestations (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS compliance_attestations_resource_idx
  ON compliance_attestations (resource_type, resource_id);

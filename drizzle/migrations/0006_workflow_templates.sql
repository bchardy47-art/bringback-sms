-- Migration 0006: Workflow Template Library
-- Adds `key` and `is_template` columns to the workflows table so that
-- pre-built DLR templates can be stored alongside (and distinguished from)
-- live tenant-specific workflows.

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE;

-- Unique per tenant so a template can only be seeded once per dealership.
-- Partial index — only applies when `key` is not NULL.
CREATE UNIQUE INDEX IF NOT EXISTS workflows_tenant_key_idx
  ON workflows (tenant_id, key)
  WHERE key IS NOT NULL;

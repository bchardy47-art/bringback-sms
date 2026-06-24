-- First-party admin activity log for /admin/activity.
-- Append-only. No raw IPs (hashed only), no SMS bodies, no lead phone numbers.
-- Denormalised actor/tenant snapshot; no FKs so the log survives deletions.

CREATE TABLE IF NOT EXISTS "activity_events" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL,
  "actor_user_id" uuid,
  "actor_email"   text,
  "actor_role"    text,
  "tenant_id"     uuid,
  "tenant_name"   text,
  "event_type"    text NOT NULL,
  "path"          text,
  "method"        text,
  "user_agent"    text,
  "ip_hash"       text,
  "metadata"      jsonb
);

CREATE INDEX IF NOT EXISTS "activity_events_created_idx" ON "activity_events" ("created_at");
CREATE INDEX IF NOT EXISTS "activity_events_type_idx"    ON "activity_events" ("event_type");
CREATE INDEX IF NOT EXISTS "activity_events_tenant_idx"  ON "activity_events" ("tenant_id");

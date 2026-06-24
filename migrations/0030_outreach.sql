-- Brian-only admin dealer-outreach CRM (controlled monthly demo invites).
--
-- Scope: internal admin outreach to RESEARCHED dealership prospects. This is
-- NOT dealer-facing, NOT lead/SMS data, and is fully separate from the
-- tenant-scoped messaging tables. No FKs into tenants/leads — these rows are
-- about external prospects Brian is trying to sign, not existing customers.
--
-- Also adds `admin_notes` — internal per-tenant notes for the dealer command
-- center. PRIVACY: notes never auto-capture SMS bodies or lead phone numbers.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS so partial reruns are safe.

-- ── Prospects ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "dealer_prospects" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at"           timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"           timestamp with time zone DEFAULT now() NOT NULL,
  "dealership_name"      text NOT NULL,
  "city"                 text,
  "state"                text,
  "website"              text,
  "main_phone"           text,
  "public_email"         text,
  "contact_form_url"     text,
  "best_contact_name"    text,
  "best_contact_title"   text,
  "source_url"           text,
  "source_notes"         text,
  "fit_notes"            text,
  "priority"             text DEFAULT 'B' NOT NULL,    -- A | B | C
  "personalization_line" text,
  "status"               text DEFAULT 'new' NOT NULL,
  "last_contacted_at"    timestamp with time zone,
  "next_eligible_at"     timestamp with time zone,
  "do_not_contact_at"    timestamp with time zone,
  "do_not_contact_reason" text,
  "archived_at"          timestamp with time zone,
  "created_by_user_id"   uuid,
  "created_by_email"     text,
  "metadata"             jsonb
);

CREATE INDEX IF NOT EXISTS "dealer_prospects_created_idx"        ON "dealer_prospects" ("created_at");
CREATE INDEX IF NOT EXISTS "dealer_prospects_status_idx"         ON "dealer_prospects" ("status");
CREATE INDEX IF NOT EXISTS "dealer_prospects_priority_idx"       ON "dealer_prospects" ("priority");
CREATE INDEX IF NOT EXISTS "dealer_prospects_public_email_idx"   ON "dealer_prospects" ("public_email");
CREATE INDEX IF NOT EXISTS "dealer_prospects_website_idx"        ON "dealer_prospects" ("website");
CREATE INDEX IF NOT EXISTS "dealer_prospects_next_eligible_idx"  ON "dealer_prospects" ("next_eligible_at");

-- ── Email templates ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "outreach_templates" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "key"            text NOT NULL UNIQUE,
  "name"           text NOT NULL,
  "description"    text,
  "subject"        text NOT NULL,
  "preview_text"   text,
  "body_text"      text NOT NULL,
  "body_html"      text,
  "is_active"      boolean DEFAULT true NOT NULL,
  "created_by_email" text,
  "metadata"       jsonb
);

-- ── Send log (append-only) ───────────────────────────────────────────────────
-- No FK on prospect_id: this is an audit log that must survive prospect deletes.
CREATE TABLE IF NOT EXISTS "outreach_sends" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
  "prospect_id"           uuid NOT NULL,
  "template_id"           uuid,
  "sent_by_user_id"       uuid,
  "sent_by_email"         text,
  "to_email"              text NOT NULL,
  "from_email"            text,
  "subject"               text NOT NULL,
  "status"                text NOT NULL,   -- test_sent | sent | failed | skipped | dry_run
  "provider"              text,
  "provider_message_id"   text,
  "failure_reason"        text,
  "skip_reason"           text,
  "is_test"               boolean DEFAULT false NOT NULL,
  "cooldown_window_start" timestamp with time zone,
  "cooldown_window_end"   timestamp with time zone,
  "metadata"              jsonb
);

CREATE INDEX IF NOT EXISTS "outreach_sends_created_idx"  ON "outreach_sends" ("created_at");
CREATE INDEX IF NOT EXISTS "outreach_sends_prospect_idx" ON "outreach_sends" ("prospect_id");
CREATE INDEX IF NOT EXISTS "outreach_sends_to_email_idx" ON "outreach_sends" ("to_email");
CREATE INDEX IF NOT EXISTS "outreach_sends_status_idx"   ON "outreach_sends" ("status");

-- ── Prospect notes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "outreach_notes" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id"    uuid NOT NULL,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"     timestamp with time zone,
  "author_user_id" uuid,
  "author_email"   text,
  "body"           text NOT NULL
);

CREATE INDEX IF NOT EXISTS "outreach_notes_prospect_idx" ON "outreach_notes" ("prospect_id");

-- ── Email suppression list ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "outreach_suppressions" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at"       timestamp with time zone DEFAULT now() NOT NULL,
  "email"            text,
  "domain"           text,
  "dealership_name"  text,
  "reason"           text,
  "source"           text,
  "created_by_email" text
);

CREATE INDEX IF NOT EXISTS "outreach_suppressions_email_idx"  ON "outreach_suppressions" ("email");
CREATE INDEX IF NOT EXISTS "outreach_suppressions_domain_idx" ON "outreach_suppressions" ("domain");

-- ── Per-tenant admin notes (dealer command center) ───────────────────────────
-- Internal notes Brian/admins keep on a dealership. No FK so notes survive a
-- tenant teardown for the audit trail.
CREATE TABLE IF NOT EXISTS "admin_notes" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"      uuid NOT NULL,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"     timestamp with time zone,
  "author_user_id" uuid,
  "author_email"   text,
  "body"           text NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_notes_tenant_idx" ON "admin_notes" ("tenant_id");

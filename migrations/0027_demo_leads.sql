-- Phase 17: Demo lead capture from /book-demo landing page.
-- Prospects who submit the "Book My Demo" form are stored here for operator follow-up.
-- No tenant association — these are pre-customer inbound leads.

CREATE TABLE IF NOT EXISTS "demo_leads" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dealership_name"      text NOT NULL,
  "decision_maker_name"  text NOT NULL,
  "phone"                text NOT NULL,
  "email"                text NOT NULL,
  "status"               text NOT NULL DEFAULT 'new',
  "source"               text NOT NULL DEFAULT 'dlr_email_book_demo',
  "notes"                text NOT NULL DEFAULT '',
  "last_contacted_at"    timestamp with time zone,
  "created_at"           timestamp NOT NULL DEFAULT now(),
  "updated_at"           timestamp NOT NULL DEFAULT now()
);

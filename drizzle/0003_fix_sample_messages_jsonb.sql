-- Migration: 0003_fix_sample_messages_jsonb
-- Changes ten_dlc_sample_messages from text[] to jsonb to match schema.ts.
-- The column was previously auto-created as text[]; the correct type is jsonb.
-- Any existing values (all NULL — no tenants have been provisioned yet) are preserved.

ALTER TABLE "tenants"
  ALTER COLUMN "ten_dlc_sample_messages"
  TYPE jsonb
  USING CASE
    WHEN "ten_dlc_sample_messages" IS NULL THEN NULL
    ELSE array_to_json("ten_dlc_sample_messages")
  END;

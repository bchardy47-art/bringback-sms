-- Password reset tokens — single-use, hashed, 60-minute expiry.
-- Token plain-text is emailed to the user; only the SHA-256 hash is stored.

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at"    timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "prt_user_id_idx"    ON "password_reset_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "prt_token_hash_idx" ON "password_reset_tokens" ("token_hash");

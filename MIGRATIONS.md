# Database Migrations

## Current layout (read this before adding a migration)

This repo has accumulated migrations in three directories. All of them have been
applied (in order) to production. **For new migrations, use `migrations/`.**

| Path                  | Files       | Origin                                | Status on prod     |
|-----------------------|-------------|---------------------------------------|--------------------|
| `drizzle/`            | `0000_*`, `0001_open_jimmy_woo` | `drizzle-kit generate` output | Applied |
| `drizzle/`            | `0001_dealer_intakes`, `0002_tenants_phase12`, `0003_fix_sample_messages_jsonb` | Hand-written (legacy) | Applied |
| `drizzle/migrations/` | `0001_safety_gates` … `0015_automotive_signals` | Hand-written (phased) | Applied |
| `migrations/`         | `0016_age_bucket_classification` … and onward | Hand-written (current) | Applied through highest committed file |

The numbering between the three directories is *not* globally unique
(both `drizzle/0001_open_jimmy_woo.sql` and `drizzle/0001_dealer_intakes.sql`
exist). This is intentional historical baggage — we keep the on-disk names
stable so the deploy scripts that reference them by path keep working.

## Adding a new migration

1. Create a new file in `migrations/`, named `NNNN_short_description.sql` where
   `NNNN` is one greater than the highest existing file in `migrations/`.
2. Make it idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   etc.) — production has applied every file at least once and partial reruns
   should not error.
3. If the change is also reflected in `src/lib/db/schema.ts`, update the schema
   in the same commit.
4. Apply on the server with:
   ```
   psql "$DATABASE_URL" -f /opt/dlr/migrations/NNNN_short_description.sql
   ```

## Why `drizzle-kit generate` is not the source of truth

The hand-written migration files have diverged from what
`drizzle-kit generate` would produce (we added compliance, pilot, dealer
intake, dealer invite, age-bucket, takeover, etc. as targeted SQL — not via
the diff tool). The schema in `src/lib/db/schema.ts` is the canonical
description of the current database; the SQL files are the canonical record
of how production got there.

## drizzle.config.ts

Points `out` at `./migrations` so a future `drizzle-kit generate` would land
files in the active directory. The previous setting (`./drizzle`) is the
reason for the duplicate `drizzle/` naming collisions above.

/**
 * Local-dev migration runner.
 *
 * Why this exists: `npm run db:migrate` calls `drizzle-kit migrate`, which
 * looks for `migrations/meta/_journal.json`. The journal file does not
 * exist in this repo because the active migration set under `migrations/`
 * is hand-written SQL — see MIGRATIONS.md. `drizzle-kit migrate` will
 * therefore always error out locally.
 *
 * Production deploys apply these files with `psql -f` per file (see
 * MIGRATIONS.md, "Adding a new migration"); this script does the same
 * thing for a local Postgres so a developer can get an empty/old DB up
 * to date with one command.
 *
 * Replay order (matches the order MIGRATIONS.md says prod applied them):
 *   1. drizzle/0000_freezing_maggott.sql           (auto-generated baseline)
 *   2. drizzle/0001_open_jimmy_woo.sql             (auto-generated)
 *   3. drizzle/0001_dealer_intakes.sql             (hand-written, after open_jimmy_woo)
 *   4. drizzle/0002_tenants_phase12.sql
 *   5. drizzle/0003_fix_sample_messages_jsonb.sql
 *   6. drizzle/migrations/0001_safety_gates.sql … 0015_automotive_signals.sql
 *   7. migrations/0016_*.sql … 00NN_*.sql
 *
 * The duplicate `0001_*` filenames in `drizzle/` are intentional historical
 * baggage. We hard-code the order here rather than relying on alphabetical
 * sort across mixed directories, so the schema-creating
 * `0001_dealer_intakes.sql` runs after the auto-generated
 * `0001_open_jimmy_woo.sql` (the order prod applied them).
 *
 * Safety:
 *   - Reads DATABASE_URL from .env.local (preferred) or .env via
 *     dotenv/config, the same pattern `scripts/seed.ts` uses. Never
 *     prints the URL.
 *   - Hand-written migrations are required to use `IF NOT EXISTS` /
 *     `ADD VALUE IF NOT EXISTS` guards (MIGRATIONS.md), and the
 *     auto-generated drizzle baseline wraps enums in `DO $$ ... EXCEPTION
 *     WHEN duplicate_object` so re-running against a partially-migrated
 *     DB is a no-op. Two legacy files (0001_open_jimmy_woo,
 *     0002_tenants_phase12, 0003_fix_sample_messages_jsonb) are pure
 *     ALTERs without IF NOT EXISTS guards on their column adds; if they
 *     fail on rerun, the script halts and prints the file so a developer
 *     can inspect.
 *   - Stops on first SQL error.
 *   - DOES NOT alter production behaviour: production still applies
 *     migrations via the deploy scripts that shell out to psql against
 *     `/opt/dlr/migrations/*.sql`.
 *
 * Usage:
 *   npm run db:migrate:local
 */

import 'dotenv/config'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

// Hard-coded order for the historical drizzle/ root files (duplicate
// 0001_* filenames make lexical sort unsafe). MIGRATIONS.md is the
// source of truth for the order.
const DRIZZLE_ROOT_ORDER = [
  '0000_freezing_maggott.sql',
  '0001_open_jimmy_woo.sql',
  '0001_dealer_intakes.sql',
  '0002_tenants_phase12.sql',
  '0003_fix_sample_messages_jsonb.sql',
]

/**
 * Postgres SQLSTATEs that mean "this schema object already exists" — safe
 * to skip during a historical replay because the goal is just to catch a
 * fresh dev DB up to the prod baseline. Anything outside this set still
 * halts the run.
 *
 * Codes (per the Postgres docs):
 *   42701 duplicate_column
 *   42P07 duplicate_table
 *   42710 duplicate_object   (indexes, constraints, types, triggers)
 *   42P06 duplicate_schema
 *   42712 duplicate_alias
 *   42723 duplicate_function
 */
const DUPLICATE_SQLSTATES = new Set([
  '42701',
  '42P07',
  '42710',
  '42P06',
  '42712',
  '42723',
])

/**
 * Whether duplicate-object errors should be treated as skip-only when
 * replaying files in this directory.
 *
 *   drizzle/             → yes, includes the auto-generated baseline whose
 *                          ALTER TABLE ADD COLUMN statements are not
 *                          guarded with IF NOT EXISTS.
 *   drizzle/migrations/  → yes, historical hand-written set; should be
 *                          idempotent but allow forgiveness if not.
 *   migrations/          → no, current active set. MIGRATIONS.md mandates
 *                          IF NOT EXISTS guards. A duplicate-* error on a
 *                          new file is a real bug we want to surface, not
 *                          mask.
 */
function isHistorical(dir: string): boolean {
  return dir === 'drizzle' || dir === 'drizzle/migrations'
}

type PrecheckResult = { skip: true; reason: string } | { skip: false }

/**
 * Per-file prechecks. Keyed by `<dir>/<file>` so a skip rule applies to
 * exactly one historical migration whose intended end-state is already
 * present in the DB. This is intentionally narrow — we do NOT
 * blanket-skip any SQLSTATE globally; each entry here corresponds to a
 * specific historical replay quirk on fresh local DBs.
 *
 * Anything not listed here runs normally.
 */
const FILE_PRECHECKS: Record<
  string,
  (sql: postgres.Sql) => Promise<PrecheckResult>
> = {
  /**
   * Migration drizzle/0003 was written when `tenants.ten_dlc_sample_messages`
   * existed as `text[]` and converts it to `jsonb` via array_to_json().
   * However, drizzle/0002_tenants_phase12.sql (which runs *before* 0003
   * in the replay order) creates the column as `jsonb` directly with
   * `ADD COLUMN IF NOT EXISTS`. On any fresh DB the column is already
   * jsonb when 0003 fires, so `array_to_json(jsonb)` errors with
   * SQLSTATE 42883 (undefined_function).
   *
   * Safe skip: only when the column is already jsonb. If for some
   * reason it's still text[], let the migration try and surface its
   * own error.
   */
  'drizzle/0003_fix_sample_messages_jsonb.sql': async (sql) => {
    const rows = await sql<{ data_type: string }[]>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tenants'
        AND column_name = 'ten_dlc_sample_messages'
    `
    const t = rows[0]?.data_type
    if (t === 'jsonb') {
      return { skip: true, reason: `tenants.ten_dlc_sample_messages is already jsonb` }
    }
    return { skip: false }
  },
}

function listSequential(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
}

/**
 * Split a drizzle-kit generated SQL file into individual statements at
 * its `--> statement-breakpoint` markers. Hand-written files without
 * the marker are returned as a single chunk so they execute as one
 * multi-statement command (their internal transactions/DO blocks are
 * preserved that way).
 */
function splitStatements(body: string): string[] {
  if (!body.includes('--> statement-breakpoint')) return [body]
  return body
    .split(/-->\s*statement-breakpoint\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      '[migrate-local] DATABASE_URL is not set. Make sure .env or .env.local ' +
        'contains DATABASE_URL=postgres://... and that you ran this via ' +
        '`npm run db:migrate:local` (which loads dotenv).',
    )
    process.exit(1)
  }

  const cwd = process.cwd()
  // Sequence: drizzle/ (hand-ordered) → drizzle/migrations/ (lexical) → migrations/ (lexical).
  const sequence: Array<{ dir: string; file: string }> = []
  for (const f of DRIZZLE_ROOT_ORDER) {
    const p = join(cwd, 'drizzle', f)
    if (existsSync(p)) sequence.push({ dir: 'drizzle', file: f })
  }
  for (const f of listSequential(join(cwd, 'drizzle/migrations'))) {
    sequence.push({ dir: 'drizzle/migrations', file: f })
  }
  for (const f of listSequential(join(cwd, 'migrations'))) {
    sequence.push({ dir: 'migrations', file: f })
  }

  if (sequence.length === 0) {
    console.error('[migrate-local] No migration files found.')
    process.exit(1)
  }

  // max: 1 — sequential connection, matches one-at-a-time psql -f semantics.
  const sql = postgres(url, { max: 1, onnotice: () => {} })

  console.log(
    `[migrate-local] Applying ${sequence.length} migrations across ` +
      `drizzle/, drizzle/migrations/, migrations/ (idempotent — re-runs are safe).`,
  )

  let applied = 0
  let skipped = 0
  let fileSkipped = 0
  try {
    for (const { dir, file } of sequence) {
      const key = `${dir}/${file}`
      const precheck = FILE_PRECHECKS[key]
      if (precheck) {
        const result = await precheck(sql)
        if (result.skip) {
          console.log(`  → ${key} ... skipped (${result.reason})`)
          fileSkipped++
          continue
        }
      }

      const path = join(cwd, dir, file)
      const body = readFileSync(path, 'utf8')
      const statements = splitStatements(body)
      const allowSkip = isHistorical(dir)
      const counts = { ok: 0, skipped: 0 }

      process.stdout.write(`  → ${key} ... `)
      for (const stmt of statements) {
        try {
          await sql.unsafe(stmt)
          counts.ok++
        } catch (err) {
          // postgres-js puts the Postgres SQLSTATE in the `code` field of
          // its error object (postgres.PostgresError extends Error and
          // carries .code as the 5-char SQLSTATE string).
          const code = (err as { code?: string }).code
          if (allowSkip && code && DUPLICATE_SQLSTATES.has(code)) {
            counts.skipped++
            continue
          }
          // Real error — halt and tell the developer exactly which
          // file+statement broke so they can inspect.
          process.stdout.write('FAILED\n')
          console.error(
            `[migrate-local] Stopped on ${key} ` +
              `(SQLSTATE=${code ?? 'n/a'}): ` +
              (err instanceof Error ? err.message : String(err)),
          )
          if (statements.length > 1) {
            const preview = stmt.length > 200 ? stmt.slice(0, 200) + '…' : stmt
            console.error(`[migrate-local] Failing statement:\n${preview}`)
          }
          process.exit(1)
        }
      }
      if (counts.skipped > 0) {
        process.stdout.write(
          `ok (applied ${counts.ok}, skipped ${counts.skipped} already-exists)\n`,
        )
      } else {
        process.stdout.write('ok\n')
      }
      applied++
      skipped += counts.skipped
    }
  } finally {
    await sql.end({ timeout: 2 })
  }

  const tail: string[] = []
  if (skipped > 0) tail.push(`${skipped} statements skipped (already-exists)`)
  if (fileSkipped > 0) tail.push(`${fileSkipped} files skipped (precheck end-state matched)`)
  console.log(
    `[migrate-local] Done. Applied/verified ${applied} files` +
      (tail.length > 0 ? ` (${tail.join(', ')}).` : '.'),
  )
}

main().catch((err) => {
  console.error('[migrate-local] Unexpected error:', err)
  process.exit(1)
})

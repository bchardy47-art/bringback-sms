/**
 * Pre-demo inbox cleanup for a specific tenant.
 *
 * Removes three categories of trust-destroying test artifacts that have
 * accumulated in a demo tenant's inbox during QA:
 *
 *   1. Bare "yo" (and similar one-token junk) outbound messages —
 *      operator typed test text that should never have left.
 *   2. Duplicate consecutive outbound automation messages — same body
 *      sent multiple times to the same lead within a short window
 *      (looks like double-texting).
 *   3. Fake "Human-Owned" conversations — humanTookOverAt was set but
 *      no outbound message was sent by the dealer after take-over.
 *      We clear humanTookOverAt so the conversation drops back to
 *      Automated and the inbox honestly reflects state.
 *
 * Default is dry-run. Pass --apply to actually mutate the database.
 *
 * Usage:
 *   npx tsx scripts/demo-cleanup-inbox.ts --tenant-id <uuid>
 *   npx tsx scripts/demo-cleanup-inbox.ts --tenant-name "Test Motors Honda"
 *   npx tsx scripts/demo-cleanup-inbox.ts --tenant-id <uuid> --apply
 *
 * Environment: DATABASE_URL must be set.
 */

import 'dotenv/config'
import { and, eq, ilike, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '../src/lib/db'
import {
  tenants,
  conversations,
  messages,
} from '../src/lib/db/schema'

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}

const apply = process.argv.includes('--apply')
const tenantId = getArg('--tenant-id')
const tenantName = getArg('--tenant-name')

// Bare junk strings we treat as definite test artifacts (case-insensitive,
// after trimming whitespace + trailing punctuation).
const JUNK_BODIES = new Set([
  'yo',
  'test',
  'hi',
  'hello',
  'hey',
  'asdf',
  'lol',
  'ok',
])

function normalize(body: string): string {
  return body.trim().replace(/[.!?]+$/, '').toLowerCase()
}

async function resolveTenantId(): Promise<string> {
  if (tenantId) return tenantId
  if (!tenantName) {
    console.error(
      'Error: provide --tenant-id <uuid> or --tenant-name "Name Contains"',
    )
    process.exit(1)
  }
  const rows = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(ilike(tenants.name, `%${tenantName}%`))
  if (rows.length === 0) {
    console.error(`No tenant matched name like "${tenantName}".`)
    process.exit(1)
  }
  if (rows.length > 1) {
    console.error('Multiple tenants matched:')
    for (const r of rows) console.error(`  ${r.id}  ${r.name}`)
    console.error('Pass --tenant-id <uuid> to disambiguate.')
    process.exit(1)
  }
  console.log(`Resolved tenant: ${rows[0].name} (${rows[0].id})`)
  return rows[0].id
}

async function main() {
  console.log(apply ? '── LIVE RUN ──' : '── DRY RUN ──')

  const tid = await resolveTenantId()

  // Load all messages for this tenant's conversations, grouped by conversation.
  // We need to make per-conversation decisions about duplicates, so pulling
  // everything once is simpler than streaming.
  //
  // Use an explicit column whitelist to avoid pulling columns the running
  // codebase has in the schema but the local DB hasn't migrated yet (e.g.
  // takenOverBy was added in a later migration). Cleanup must work even
  // when the DB is one migration behind.
  const convs = await db.query.conversations.findMany({
    where: eq(conversations.tenantId, tid),
    columns: {
      id: true,
      tenantId: true,
      status: true,
      updatedAt: true,
      humanTookOverAt: true,
    },
    with: {
      lead: { columns: { firstName: true, lastName: true } },
      messages: {
        orderBy: (m, { asc }) => [asc(m.createdAt)],
        columns: {
          id: true,
          direction: true,
          body: true,
          createdAt: true,
        },
      },
    },
  })
  console.log(`\nFound ${convs.length} conversation(s) for tenant.`)

  // ── 1. Junk outbound messages ────────────────────────────────────────────
  const junkMsgIds: string[] = []
  for (const c of convs) {
    for (const m of c.messages) {
      if (m.direction !== 'outbound') continue
      if (JUNK_BODIES.has(normalize(m.body))) {
        junkMsgIds.push(m.id)
        console.log(
          `[junk] conv=${c.id.slice(0, 8)} lead=${c.lead.firstName} ` +
          `${c.lead.lastName}  body="${m.body}"  id=${m.id}`,
        )
      }
    }
  }

  // ── 2. Duplicate consecutive outbound messages ──────────────────────────
  // For each conversation, if two or more outbound messages share the same
  // normalized body and were sent within 24h of each other, keep the
  // earliest and delete the rest.
  const dupMsgIds: string[] = []
  for (const c of convs) {
    const seen = new Map<string, { id: string; createdAt: Date }>() // body -> earliest kept
    for (const m of c.messages) {
      if (m.direction !== 'outbound') continue
      const key = normalize(m.body)
      const prior = seen.get(key)
      if (!prior) {
        seen.set(key, { id: m.id, createdAt: new Date(m.createdAt) })
        continue
      }
      const gapHours =
        (new Date(m.createdAt).getTime() - prior.createdAt.getTime()) /
        3_600_000
      if (gapHours < 24) {
        dupMsgIds.push(m.id)
        console.log(
          `[dup ] conv=${c.id.slice(0, 8)} lead=${c.lead.firstName} ` +
          `${c.lead.lastName}  body="${m.body.slice(0, 60)}…"  id=${m.id}` +
          `  (${gapHours.toFixed(1)}h after kept copy)`,
        )
      } else {
        // Treat as a legitimate follow-up cadence — don't touch it.
        seen.set(key, { id: m.id, createdAt: new Date(m.createdAt) })
      }
    }
  }

  // ── 3. Fake Human-Owned conversations ───────────────────────────────────
  // humanTookOverAt is set but the dealer has not actually sent an outbound
  // message after that timestamp. Clear humanTookOverAt so the inbox isn't
  // misleading.
  const convIdsToResetTakeover: string[] = []
  for (const c of convs) {
    if (!c.humanTookOverAt) continue
    const takeoverAt = new Date(c.humanTookOverAt).getTime()
    const dealerReplied = c.messages.some(
      (m) =>
        m.direction === 'outbound' &&
        new Date(m.createdAt).getTime() > takeoverAt,
    )
    if (!dealerReplied) {
      convIdsToResetTakeover.push(c.id)
      console.log(
        `[take] conv=${c.id.slice(0, 8)} lead=${c.lead.firstName} ` +
        `${c.lead.lastName}  humanTookOverAt set but no dealer reply — clearing`,
      )
    }
  }

  console.log('\nSummary:')
  console.log(`  junk outbound messages to delete: ${junkMsgIds.length}`)
  console.log(`  duplicate outbound messages to delete: ${dupMsgIds.length}`)
  console.log(`  fake human-owned takeovers to reset: ${convIdsToResetTakeover.length}`)

  if (!apply) {
    console.log('\nDRY RUN — no changes written. Add --apply to commit.')
    return
  }

  const idsToDelete = [...junkMsgIds, ...dupMsgIds]
  if (idsToDelete.length) {
    // Confirm rows still belong to this tenant before deleting — defense
    // against an unlikely race where a conversation was reassigned between
    // our read and our write.
    const safeIds = (
      await db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            inArray(messages.id, idsToDelete),
            eq(conversations.tenantId, tid),
          ),
        )
    ).map((r) => r.id)
    if (safeIds.length !== idsToDelete.length) {
      console.warn(
        `WARNING: ${idsToDelete.length - safeIds.length} message id(s) no longer belong to this tenant; skipping those.`,
      )
    }
    if (safeIds.length) {
      await db.delete(messages).where(inArray(messages.id, safeIds))
      console.log(`✓ Deleted ${safeIds.length} message row(s).`)
    }
  }

  if (convIdsToResetTakeover.length) {
    await db
      .update(conversations)
      .set({ humanTookOverAt: null, updatedAt: new Date() })
      .where(
        and(
          inArray(conversations.id, convIdsToResetTakeover),
          eq(conversations.tenantId, tid),
          isNotNull(conversations.humanTookOverAt),
        ),
      )
    console.log(`✓ Reset ${convIdsToResetTakeover.length} human-takeover flag(s).`)
  }

  // Bump conversation updatedAt for any conversation we deleted messages
  // from, so the inbox sidebar's most-recent-first ordering reflects the
  // new "last message" timestamp rather than the deleted one.
  if (idsToDelete.length) {
    const touched = Array.from(
      new Set(
        convs
          .filter((c) =>
            c.messages.some((m) => idsToDelete.includes(m.id)),
          )
          .map((c) => c.id),
      ),
    )
    if (touched.length) {
      await db
        .update(conversations)
        .set({ updatedAt: sql`now()` })
        .where(
          and(
            inArray(conversations.id, touched),
            eq(conversations.tenantId, tid),
          ),
        )
    }
  }

  console.log('\nDone.')
}

main()
  .catch((err) => {
    console.error('Fatal:', err)
    process.exit(1)
  })
  .finally(() => process.exit(0))

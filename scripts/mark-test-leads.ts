/**
 * Admin script: bulk-mark test / fake contacts so they are permanently
 * excluded from automation.
 *
 * Sets:
 *   isTest         = true
 *   doNotAutomate  = true
 *   state          = 'dead'  (unless they have a real inbound reply)
 *
 * Usage examples
 * ──────────────
 *  # Mark by exact phone number(s)
 *  npx tsx scripts/mark-test-leads.ts --phones "+15550000001,+15550000002"
 *
 *  # Mark by name pattern (case-insensitive substring match)
 *  npx tsx scripts/mark-test-leads.ts --name-contains "test,fake,demo,sample"
 *
 *  # Mark by CRM lead ID list
 *  npx tsx scripts/mark-test-leads.ts --crm-ids "CRM-001,CRM-002"
 *
 *  # Dry-run first (shows what would be updated, writes nothing)
 *  npx tsx scripts/mark-test-leads.ts --name-contains "test" --dry-run
 *
 *  # Combine filters: phones OR name patterns
 *  npx tsx scripts/mark-test-leads.ts --phones "+15550000001" --name-contains "fake"
 *
 * Environment: DATABASE_URL must be set (same as the app).
 */

import 'dotenv/config'
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { leads, workflowEnrollments } from '../src/lib/db/schema'

// ── CLI arg parsing ───────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}

const dryRun = process.argv.includes('--dry-run')
const phonesRaw = getArg('--phones')
const nameContainsRaw = getArg('--name-contains')
const crmIdsRaw = getArg('--crm-ids')

const phones = phonesRaw ? phonesRaw.split(',').map((p) => p.trim()).filter(Boolean) : []
const namePatterns = nameContainsRaw ? nameContainsRaw.split(',').map((n) => n.trim()).filter(Boolean) : []
const crmIds = crmIdsRaw ? crmIdsRaw.split(',').map((c) => c.trim()).filter(Boolean) : []

if (!phones.length && !namePatterns.length && !crmIds.length) {
  console.error(
    'Error: provide at least one filter.\n' +
    '  --phones "+15550000001,+15550000002"\n' +
    '  --name-contains "test,fake,demo"\n' +
    '  --crm-ids "CRM-001,CRM-002"\n' +
    '  --dry-run  (optional, show only)'
  )
  process.exit(1)
}

// ── Build WHERE clause ────────────────────────────────────────────────────────

function buildWhere() {
  const conditions: ReturnType<typeof eq>[] = []

  if (phones.length) {
    conditions.push(inArray(leads.phone, phones))
  }

  for (const pattern of namePatterns) {
    conditions.push(
      or(
        ilike(leads.firstName, `%${pattern}%`),
        ilike(leads.lastName, `%${pattern}%`)
      ) as ReturnType<typeof eq>
    )
  }

  if (crmIds.length) {
    conditions.push(inArray(leads.crmLeadId, crmIds))
  }

  return conditions.length === 1 ? conditions[0] : or(...conditions)!
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(dryRun ? '── DRY RUN ─────────────────────────────' : '── LIVE RUN ────────────────────────────')
  console.log('Filters:')
  if (phones.length) console.log('  phones:', phones)
  if (namePatterns.length) console.log('  name contains:', namePatterns)
  if (crmIds.length) console.log('  crmIds:', crmIds)
  console.log()

  // Find matching leads
  const where = buildWhere()
  const matched = await db.query.leads.findMany({ where })

  if (!matched.length) {
    console.log('No leads matched the provided filters.')
    return
  }

  console.log(`Found ${matched.length} lead(s):`)
  for (const lead of matched) {
    console.log(
      `  [${lead.id}] ${lead.firstName} ${lead.lastName}  phone=${lead.phone}` +
      `  state=${lead.state}  isTest=${lead.isTest}  doNotAutomate=${lead.doNotAutomate}`
    )
  }
  console.log()

  if (dryRun) {
    console.log('DRY RUN — no changes written. Remove --dry-run to apply.')
    return
  }

  const ids = matched.map((l) => l.id)

  // 1. Cancel any active workflow enrollments so the queue doesn't fire
  const cancelResult = await db
    .update(workflowEnrollments)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(
      and(
        inArray(workflowEnrollments.leadId, ids),
        eq(workflowEnrollments.status, 'active')
      )
    )
    .returning()

  if (cancelResult.length) {
    console.log(`Cancelled ${cancelResult.length} active enrollment(s).`)
  }

  // 2. Mark leads as isTest + doNotAutomate + dead
  //    We set state to 'dead' only if there has been no inbound reply
  //    (i.e., we don't want to clobber a real responded lead).
  //    Use a raw case expression to be safe.
  await db
    .update(leads)
    .set({
      isTest: true,
      doNotAutomate: true,
      // Move to dead unless they've already responded (then preserve their state
      // so the inbox record remains meaningful).
      state: sql`
        CASE
          WHEN state IN ('responded', 'revived', 'converted') THEN state
          ELSE 'dead'::lead_state
        END
      `,
      updatedAt: new Date(),
    })
    .where(inArray(leads.id, ids))

  console.log(`✓ Marked ${ids.length} lead(s) as isTest=true, doNotAutomate=true.`)
  console.log('  Leads not in responded/revived/converted state have been moved to dead.')
  console.log()
  console.log('These contacts will never be enrolled in automation again.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

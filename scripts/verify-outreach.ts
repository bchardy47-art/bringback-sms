/**
 * One-off local verification for the outreach data layer + eligibility rule.
 * Inserts throwaway rows into a LOCAL dlr DB, asserts the 30-day rule and
 * status derivation, then deletes everything it created. Never sends email.
 *
 * Usage: npx tsx scripts/verify-outreach.ts   (DATABASE_URL must be local)
 */

import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { dealerProspects, outreachSends } from '../src/lib/db/schema'
import {
  evaluateEligibility, cooldownStart, nextEligibleFrom, isValidEmail,
} from '../src/lib/outreach/eligibility'

const url = process.env.DATABASE_URL ?? ''
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('Refusing to run: DATABASE_URL is not local.')
  process.exit(1)
}

let pass = 0, fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

async function main() {
  const now = new Date()
  const createdIds: string[] = []

  // 1. "ready" prospect — email + source, status ready → eligible
  const [ready] = await db.insert(dealerProspects).values({
    dealershipName: 'ZZ Verify Motors', city: 'Testville', state: 'TS',
    publicEmail: 'sales@zzverify.test', sourceUrl: 'https://zzverify.test/about',
    status: 'ready', priority: 'A', createdByEmail: 'verify-script',
  }).returning({ id: dealerProspects.id })
  createdIds.push(ready.id)

  // 2. DNC prospect → never eligible
  const [dnc] = await db.insert(dealerProspects).values({
    dealershipName: 'ZZ Verify DNC', publicEmail: 'no@zzverify.test',
    sourceUrl: 'https://zzverify.test/dnc', status: 'do_not_contact',
    doNotContactAt: now, priority: 'C', createdByEmail: 'verify-script',
  }).returning({ id: dealerProspects.id })
  createdIds.push(dnc.id)

  const readyRow = (await db.select().from(dealerProspects).where(eq(dealerProspects.id, ready.id)))[0]
  const dncRow = (await db.select().from(dealerProspects).where(eq(dealerProspects.id, dnc.id)))[0]

  const toElig = (r: typeof dealerProspects.$inferSelect) => ({
    id: r.id, dealershipName: r.dealershipName, publicEmail: r.publicEmail,
    sourceUrl: r.sourceUrl, status: r.status, archivedAt: r.archivedAt,
    doNotContactAt: r.doNotContactAt, nextEligibleAt: r.nextEligibleAt,
  })

  console.log('Eligibility rule:')
  check('ready prospect is eligible', evaluateEligibility(toElig(readyRow), { now, sentWithinCooldown: false }).eligible)
  check('DNC prospect is NOT eligible', !evaluateEligibility(toElig(dncRow), { now, sentWithinCooldown: false }).eligible)
  check('cooldown blocks a recently-sent prospect',
    !evaluateEligibility(toElig(readyRow), { now, sentWithinCooldown: true }).eligible)
  check('nextEligibleAt in future blocks',
    !evaluateEligibility({ ...toElig(readyRow), nextEligibleAt: nextEligibleFrom(now) }, { now, sentWithinCooldown: false }).eligible)

  console.log('Email shape:')
  check('valid email passes', isValidEmail('a@b.com'))
  check('garbage email fails', !isValidEmail('not-an-email'))

  console.log('Send-log round-trip + 30d window:')
  // A real send 10 days ago should be inside the 30-day window.
  const tenDaysAgo = new Date(now.getTime() - 10 * 864e5)
  await db.insert(outreachSends).values({
    prospectId: ready.id, toEmail: readyRow.publicEmail!, subject: 's', status: 'sent',
    sentByEmail: 'verify-script', createdAt: tenDaysAgo,
  })
  const within = await db.select().from(outreachSends).where(eq(outreachSends.prospectId, ready.id))
  const inWindow = within.some(s => s.status === 'sent' && s.createdAt >= cooldownStart(now))
  check('send 10d ago counts as within 30d cooldown', inWindow)

  // cleanup
  await db.delete(outreachSends).where(eq(outreachSends.prospectId, ready.id))
  for (const id of createdIds) await db.delete(dealerProspects).where(eq(dealerProspects.id, id))
  console.log('Cleaned up test rows.')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })

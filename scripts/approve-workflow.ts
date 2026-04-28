/**
 * Approve "14-Day Stale Lead Revival" for live sends.
 *
 * Sets approvedForLive = true, activationStatus = 'approved',
 * approvedAt, and approvedBy on the workflow record.
 *
 * Usage:
 *   DATABASE_URL=postgresql://brianhardy@localhost:5432/dlr npx tsx scripts/approve-workflow.ts
 */

import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { workflows } from '../src/lib/db/schema'

async function main() {
  console.log('\n✅ Approving "14-Day Stale Lead Revival" for live sends...\n')

  const workflow = await db.query.workflows.findFirst({
    where: eq(workflows.name, '14-Day Stale Lead Revival'),
  })

  if (!workflow) {
    console.error('❌ Workflow not found.')
    process.exit(1)
  }

  if (workflow.approvedForLive) {
    console.log('ℹ️  Already approved — nothing to do.')
    process.exit(0)
  }

  const now = new Date()
  await db.update(workflows).set({
    approvedForLive: true,
    approvedAt: now,
    approvedBy: 'admin',
    activationStatus: 'approved',
    updatedAt: now,
  }).where(eq(workflows.id, workflow.id))

  console.log(`✅ Approved: "${workflow.name}" (${workflow.id})`)
  console.log(`   approvedAt: ${now.toISOString()}`)
  console.log('\n   Next: check /admin/dlr/go-no-go to verify blocker count.')
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Failed:', err)
  process.exit(1)
})

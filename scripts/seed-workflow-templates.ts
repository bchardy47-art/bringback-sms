/**
 * Workflow Template Seeder
 *
 * Seeds all six DLR workflow library templates for the demo tenant (or the
 * tenant specified in VERIFY_TENANT_ID / SEED_TENANT_ID env vars).
 *
 * Behaviour:
 *   - isActive = false  (templates are inactive — never auto-enroll leads)
 *   - isTemplate = true (marked as library entries, not live workflows)
 *   - Idempotent — re-running updates existing steps rather than duplicating
 *   - Logs each template created or updated
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/seed-workflow-templates.ts
 */

import { config } from 'dotenv'
config({ path: new URL('../.env.local', import.meta.url).pathname })

import { eq, and } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { tenants, workflows, workflowSteps } from '../src/lib/db/schema'
import { WORKFLOW_TEMPLATES } from '../src/lib/workflows/templates'

async function main() {
  // Resolve tenant
  const tenantId =
    process.env.SEED_TENANT_ID ??
    process.env.VERIFY_TENANT_ID ??
    (await db.query.tenants.findFirst().then((t) => t?.id))

  if (!tenantId) {
    console.error('❌ No tenant found. Run scripts/seed.ts first.')
    process.exit(1)
  }

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  console.log(`\n🌱 Seeding workflow templates for: ${tenant?.name ?? tenantId}\n`)

  let created = 0
  let updated = 0

  for (const template of WORKFLOW_TEMPLATES) {
    // Check for existing workflow with this key for this tenant
    const existing = await db.query.workflows.findFirst({
      where: and(eq(workflows.tenantId, tenantId), eq(workflows.key, template.key)),
    })

    let workflowId: string

    if (existing) {
      // Update metadata (name, description, triggerConfig) — leave isActive as-is
      await db
        .update(workflows)
        .set({
          name:          template.name,
          description:   template.description,
          triggerType:   template.triggerType,
          triggerConfig: template.triggerConfig,
          isTemplate:    true,
          updatedAt:     new Date(),
        })
        .where(eq(workflows.id, existing.id))

      // Wipe and re-insert steps so ordering is always correct
      await db.delete(workflowSteps).where(eq(workflowSteps.workflowId, existing.id))
      workflowId = existing.id
      updated++
    } else {
      // Insert new template workflow (inactive by default)
      const [inserted] = await db
        .insert(workflows)
        .values({
          tenantId,
          name:          template.name,
          description:   template.description,
          triggerType:   template.triggerType,
          triggerConfig: template.triggerConfig,
          isActive:      false,
          isTemplate:    true,
          key:           template.key,
        })
        .returning()

      workflowId = inserted.id
      created++
    }

    // Insert steps
    await db.insert(workflowSteps).values(
      template.steps.map((step) => ({
        workflowId,
        position: step.position,
        type:     step.type as 'send_sms' | 'condition' | 'assign',
        config:   step.config as never,
      }))
    )

    const action = existing ? 'updated' : 'created'
    console.log(`  ${action === 'created' ? '✅' : '♻️ '} ${action}: "${template.name}" (${template.steps.length} steps, key=${template.key})`)
  }

  console.log(`\n✅ Done — ${created} created, ${updated} updated\n`)
  console.log('Templates are isActive=false — no leads will be enrolled automatically.')
  console.log('To activate a template for a tenant, set isActive=true in the admin UI.\n')
}

main()
  .catch((err) => { console.error('❌ Seeder failed:', err); process.exit(1) })
  .finally(() => process.exit(0))

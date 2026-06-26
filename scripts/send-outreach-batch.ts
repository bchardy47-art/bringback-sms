import 'dotenv/config'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { dealerProspects, outreachSends } from '../src/lib/db/schema'
import { cooldownStart, evaluateEligibility, normalizeEmail, sendEnabled } from '../src/lib/outreach/eligibility'
import { getTemplateByKey, renderTemplate, syncDefaultTemplateByKey } from '../src/lib/outreach/templates'
import { isSuppressed, sendMonthlyInvite } from '../src/lib/outreach/send'

const DEFAULT_TEMPLATE_KEY = 'dlr_pilot_invite_v1_red_revival'
const REQUIRED_SUBJECT = 'Want to try Dead Lead Revival for FREE for 30 Days?'
const REQUIRED_IMAGE = 'dlr-free-pilot-email-v2-hq.jpg'
const ACTOR = { id: 'script:outreach-batch', email: 'brian@dlr-sms.com' }

type EvalResult = {
  eligible: boolean
  reason: string
  detail: string
}

type ProspectEval = {
  prospect: typeof dealerProspects.$inferSelect
  eval: EvalResult
}

function pipe(s: string | null | undefined): string {
  return (s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').trim()
}

function parseArgs() {
  const args = process.argv.slice(2)
  const templateIdx = args.indexOf('--template')
  const limitIdx = args.indexOf('--limit')
  const templateKey =
    templateIdx >= 0 && args[templateIdx + 1] && !args[templateIdx + 1].startsWith('--')
      ? args[templateIdx + 1]
      : DEFAULT_TEMPLATE_KEY
  const limitRaw =
    limitIdx >= 0 && args[limitIdx + 1] && !args[limitIdx + 1].startsWith('--')
      ? Number(args[limitIdx + 1])
      : undefined
  const limit = Number.isFinite(limitRaw) && (limitRaw as number) > 0 ? Math.floor(limitRaw as number) : undefined
  return {
    templateKey,
    eligibleOnly: args.includes('--eligible-only'),
    requireSend: args.includes('--send'),
    limit,
  }
}

async function sentWithinCooldown(prospectId: string, now: Date): Promise<boolean> {
  const rows = await db
    .select({ id: outreachSends.id })
    .from(outreachSends)
    .where(
      and(
        eq(outreachSends.prospectId, prospectId),
        eq(outreachSends.status, 'sent'),
        gte(outreachSends.createdAt, cooldownStart(now)),
      ),
    )
    .limit(1)
  return rows.length > 0
}

async function evaluateProspect(p: typeof dealerProspects.$inferSelect, now: Date): Promise<EvalResult> {
  const sent30 = await sentWithinCooldown(p.id, now)
  const base = evaluateEligibility({
    id: p.id,
    dealershipName: p.dealershipName,
    publicEmail: p.publicEmail,
    sourceUrl: p.sourceUrl,
    status: p.status,
    archivedAt: p.archivedAt,
    doNotContactAt: p.doNotContactAt,
    nextEligibleAt: p.nextEligibleAt,
  }, { now, sentWithinCooldown: sent30 })

  if (!base.eligible) return base

  const email = normalizeEmail(p.publicEmail)
  if (email && await isSuppressed(email)) {
    return { eligible: false, reason: 'suppressed', detail: 'Email or domain is on the suppression list.' }
  }

  return { eligible: true, reason: 'eligible', detail: 'Eligible to send.' }
}

async function main() {
  const { templateKey, eligibleOnly, requireSend, limit } = parseArgs()

  // Default is ALWAYS dry-run. Real sending requires both --send and env arm.
  if (!requireSend) process.env.OUTREACH_SEND_ENABLED = 'false'

  const now = new Date()

  if (requireSend && !sendEnabled()) {
    console.error('Refusing: --send passed but OUTREACH_SEND_ENABLED is not "true".')
    process.exit(1)
  }

  await syncDefaultTemplateByKey(templateKey)
  const tpl = await getTemplateByKey(templateKey)
  if (!tpl) {
    console.error(`Template not found: ${templateKey}`)
    process.exit(1)
  }

  const prospects = await db.select().from(dealerProspects)
  const emailProspects = prospects.filter(p => (p.publicEmail ?? '').trim())

  const evaluations: ProspectEval[] = []
  for (const prospect of emailProspects) {
    evaluations.push({ prospect, eval: await evaluateProspect(prospect, now) })
  }

  const eligible = evaluations.filter(x => x.eval.eligible)
  const targets = (eligibleOnly ? eligible : evaluations)
    .slice(0, limit ?? evaluations.length)

  const renderProspect = targets[0]?.prospect ?? evaluations[0]?.prospect ?? null
  const rendered = renderProspect ? renderTemplate(tpl, renderProspect) : null
  const templateChecks = {
    subjectExact: tpl.subject === REQUIRED_SUBJECT,
    renderedSubjectExact: rendered?.subject === REQUIRED_SUBJECT,
    renderedHasHiThere: rendered?.text.includes('Hi there') ?? false,
    renderedHasUnitedAutoUtahInSubject: rendered?.subject.includes('United Auto Utah') ?? false,
    renderedHasUnitedAutoUtahInText: rendered?.text.includes('United Auto Utah') ?? false,
    renderedHasUnitedAutoUtahInHtml: rendered?.html.includes('United Auto Utah') ?? false,
    renderedHasHQImage: rendered?.html.includes(REQUIRED_IMAGE) ?? false,
  }

  console.log('TEMPLATE_CHECKS=' + JSON.stringify(templateChecks))
  if (
    !templateChecks.subjectExact ||
    !templateChecks.renderedSubjectExact ||
    !templateChecks.renderedHasHiThere ||
    templateChecks.renderedHasUnitedAutoUtahInSubject ||
    templateChecks.renderedHasUnitedAutoUtahInText ||
    templateChecks.renderedHasUnitedAutoUtahInHtml ||
    !templateChecks.renderedHasHQImage
  ) {
    console.error('Refusing: template verification failed.')
    process.exit(1)
  }

  console.log('\nRECIPIENT_TABLE')
  console.log('| Dealership | Email | Status | Source URL | Eligible | Reason |')
  console.log('|---|---|---|---|---|---|')
  for (const { prospect, eval: ev } of evaluations.sort((a, b) => (a.prospect.dealershipName ?? '').localeCompare(b.prospect.dealershipName ?? ''))) {
    console.log(`| ${pipe(prospect.dealershipName)} | ${pipe(prospect.publicEmail)} | ${pipe(prospect.status)} | ${pipe(prospect.sourceUrl) || '-'} | ${ev.eligible ? 'eligible' : 'skipped'} | ${ev.eligible ? '-' : ev.reason} |`)
  }

  const allSkips = new Map<string, number>()
  for (const { eval: ev } of evaluations.filter(x => !x.eval.eligible)) {
    allSkips.set(ev.reason, (allSkips.get(ev.reason) ?? 0) + 1)
  }

  console.log('\nCOUNTS=' + JSON.stringify({
    totalProspects: prospects.length,
    prospectsWithEmail: emailProspects.length,
    eligibleToSendNow: eligible.length,
    targetCount: targets.length,
    skipped: Object.fromEntries([...allSkips.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  }))

  const expectedConfirm = `SEND_${targets.length}_DLR_PILOT_EMAILS`
  if (requireSend && process.env.CONFIRM_DLR_BATCH_SEND !== expectedConfirm) {
    console.error(`Refusing: set CONFIRM_DLR_BATCH_SEND=${expectedConfirm} to allow this batch send.`)
    process.exit(1)
  }

  let dryRunLogged = 0
  let sent = 0
  let skipped = 0
  let failed = 0
  const outcomeReasons = new Map<string, number>()

  console.log(`\nMODE=${requireSend ? 'LIVE SEND ARMED' : 'DRY RUN ONLY'}`)
  console.log(`TEMPLATE=${templateKey}`)
  console.log(`TARGETS=${targets.length}`)

  for (const { prospect } of targets) {
    const outcome = await sendMonthlyInvite(prospect.id, templateKey, ACTOR)
    const reason = outcome.ok ? outcome.kind : outcome.reason
    outcomeReasons.set(reason, (outcomeReasons.get(reason) ?? 0) + 1)

    if (outcome.ok && outcome.kind === 'sent') sent++
    else if (!outcome.ok && outcome.kind === 'dry_run') dryRunLogged++
    else if (!outcome.ok && outcome.kind === 'skipped') skipped++
    else if (!outcome.ok && outcome.kind === 'failed') failed++
  }

  console.log('\nRESULTS=' + JSON.stringify({
    attempted: targets.length,
    sent,
    dryRunLogged,
    skipped,
    failed,
    reasons: Object.fromEntries([...outcomeReasons.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  }))

  console.log(`\nLIVE_SEND_COMMAND=OUTREACH_BUSINESS_ADDRESS="1347 W Fort Rock Dr, Saratoga Springs, UT 84045" CONFIRM_DLR_BATCH_SEND=${expectedConfirm} OUTREACH_SEND_ENABLED=true npx tsx scripts/send-outreach-batch.ts --template ${templateKey}${eligibleOnly ? ' --eligible-only' : ''}${limit ? ` --limit ${limit}` : ''} --send`)
}

main().catch(err => {
  console.error('send-outreach-batch failed:', err)
  process.exit(1)
})

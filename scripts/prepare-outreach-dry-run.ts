import 'dotenv/config'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { dealerProspects, outreachSends, outreachTemplates } from '../src/lib/db/schema'
import { cooldownStart, evaluateEligibility, normalizeEmail } from '../src/lib/outreach/eligibility'
import { getTemplateByKey, renderTemplate } from '../src/lib/outreach/templates'
import { isSuppressed, sendMonthlyInvite } from '../src/lib/outreach/send'

const TEMPLATE_KEY = 'dlr_pilot_invite_v1_red_revival'
const REQUIRED_SUBJECT = 'Want to try Dead Lead Revival for FREE for 30 Days?'
const ACTOR = { id: 'script:bulk-dry-run', email: 'brian@dlr-sms.com' }

type EvalResult = {
  eligible: boolean
  reason: string
  detail: string
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

function pipe(s: string | null | undefined): string {
  return (s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').trim()
}

async function main() {
  const now = new Date()
  const prospects = await db.select().from(dealerProspects)
  const withEmail = prospects.filter(p => (p.publicEmail ?? '').trim())

  const evaluations: Array<{ prospect: typeof dealerProspects.$inferSelect; eval: EvalResult }> = []
  for (const p of prospects) {
    evaluations.push({ prospect: p, eval: await evaluateProspect(p, now) })
  }

  const emailEvals = evaluations.filter(x => (x.prospect.publicEmail ?? '').trim())
  const eligible = emailEvals.filter(x => x.eval.eligible)

  const skipCounts = new Map<string, number>()
  for (const x of evaluations.filter(x => !x.eval.eligible)) {
    skipCounts.set(x.eval.reason, (skipCounts.get(x.eval.reason) ?? 0) + 1)
  }

  const tpl = await getTemplateByKey(TEMPLATE_KEY)
  const renderProspect = prospects[0] ?? null
  const rendered = tpl && renderProspect ? renderTemplate(tpl, renderProspect) : null

  console.log('TEMPLATE_CHECKS=' + JSON.stringify({
    exists: Boolean(tpl),
    subjectExact: tpl?.subject === REQUIRED_SUBJECT,
    dbSubject: tpl?.subject ?? null,
    bodyTextHasHiThere: tpl?.bodyText.includes('Hi there') ?? false,
    bodyTextHasUnitedAutoUtah: tpl?.bodyText.includes('United Auto Utah') ?? false,
    bodyHtmlHasUnitedAutoUtah: (tpl?.bodyHtml ?? '').includes('United Auto Utah'),
    bodyHtmlHasHQImage: (tpl?.bodyHtml ?? '').includes('dlr-free-pilot-email-v2-hq.jpg'),
    renderedSubject: rendered?.subject ?? null,
    renderedHasHiThere: rendered?.text.includes('Hi there') ?? false,
    renderedHasUnitedAutoUtahInSubject: rendered?.subject.includes('United Auto Utah') ?? false,
    renderedHasUnitedAutoUtahInText: rendered?.text.includes('United Auto Utah') ?? false,
    renderedHasUnitedAutoUtahInHtml: rendered?.html.includes('United Auto Utah') ?? false,
    renderedHasHQImage: rendered?.html.includes('dlr-free-pilot-email-v2-hq.jpg') ?? false,
  }))

  console.log('\nRECIPIENT_TABLE')
  console.log('| Dealership | Email | Status | Source URL | Eligible | Skip reason |')
  console.log('|---|---|---|---|---|---|')
  for (const { prospect, eval: ev } of emailEvals.sort((a, b) => (a.prospect.dealershipName ?? '').localeCompare(b.prospect.dealershipName ?? ''))) {
    console.log(`| ${pipe(prospect.dealershipName)} | ${pipe(prospect.publicEmail)} | ${pipe(prospect.status)} | ${pipe(prospect.sourceUrl) || '-'} | ${ev.eligible ? 'yes' : 'no'} | ${ev.eligible ? '-' : pipe(ev.reason)} |`)
  }

  console.log('\nCOUNTS=' + JSON.stringify({
    totalProspects: prospects.length,
    prospectsWithEmail: withEmail.length,
    eligibleToSendNow: eligible.length,
    skipped: Object.fromEntries([...skipCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  }))

  let dryRun = 0
  let skipped = 0
  let failed = 0
  const dryRunReasons = new Map<string, number>()

  for (const { prospect } of eligible) {
    const outcome = await sendMonthlyInvite(prospect.id, TEMPLATE_KEY, ACTOR)
    if (!outcome.ok && outcome.kind === 'dry_run') {
      dryRun++
      dryRunReasons.set(outcome.reason, (dryRunReasons.get(outcome.reason) ?? 0) + 1)
    } else if (!outcome.ok && outcome.kind === 'skipped') {
      skipped++
      dryRunReasons.set(outcome.reason, (dryRunReasons.get(outcome.reason) ?? 0) + 1)
    } else if (!outcome.ok && outcome.kind === 'failed') {
      failed++
      dryRunReasons.set(outcome.reason, (dryRunReasons.get(outcome.reason) ?? 0) + 1)
    }
  }

  console.log('\nDRY_RUN=' + JSON.stringify({
    attemptedEligible: eligible.length,
    dryRunLogged: dryRun,
    skipped,
    failed,
    reasons: Object.fromEntries([...dryRunReasons.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  }))

  console.log('\nLIVE_SEND_COMMAND=OUTREACH_BUSINESS_ADDRESS="1347 W Fort Rock Dr, Saratoga Springs, UT 84045" OUTREACH_SEND_ENABLED=true npx tsx scripts/send-outreach-batch.ts --template dlr_pilot_invite_v1_red_revival --eligible-only')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

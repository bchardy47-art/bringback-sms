/**
 * Batch 2 (ALL 20) outreach send — STRICTLY file-scoped to the 20 Batch-2
 * dealers in the ALL20 import CSV.
 *
 * Unlike scripts/send-outreach-batch.ts (which evaluates EVERY prospect in
 * dealer_prospects), this path can ONLY target the exact set of emails listed
 * in the Batch 2 ALL20 CSV. It loads that CSV, matches the emails against
 * dealer_prospects, and only ever iterates that matched-from-CSV id list.
 * A DB-wide accidental send is structurally impossible: there is no code path
 * that targets prospects outside the CSV email set.
 *
 * Batch 1 (last week) is untouched unless a Batch 1 dealer's email also appears
 * in this Batch 2 CSV — and even then the 30-day cooldown in sendMonthlyInvite
 * blocks a duplicate send (e.g. Motiv8d Motors / Dex Auto Group if contacted
 * last week are SKIPPED, never force-sent).
 *
 * Email content: read VERBATIM from public/email/DLR Pilot Invite - EMAIL.html
 * on every run — never from a DB template. This is intentional: the v1 Red
 * Revival DB template (dlr_pilot_invite_v1_red_revival) and its hq jpg are
 * retired from this send path. A bookkeeping-only template row
 * (dlr_pilot_invite_v2_hero_hybrid) exists purely so outreach_sends has a
 * stable templateId to log against — its stored subject/bodyHtml are never
 * rendered or sent; see sendMonthlyInvite's `override` option.
 *
 * Safety stack (preserved from src/lib/outreach):
 *   • dry-run by DEFAULT (OUTREACH_SEND_ENABLED forced false unless --send)
 *   • live send requires --send AND OUTREACH_SEND_ENABLED=true
 *   • live send requires CONFIRM_DLR_BATCH2_SEND=SEND_20_DLR_BATCH2_PILOT_EMAILS
 *   • exactly-20 CSV email guard (refuses on any other count)
 *   • all-20-matched guard before a LIVE send (refuses if any aren't imported)
 *   • per-prospect 30-day cooldown (authoritative outreach_sends re-query)
 *   • outreach_suppressions hard-stop
 *   • OUTREACH_BUSINESS_ADDRESS required (CAN-SPAM footer)
 *   • prints the full target name/email list before any send
 *   • refuses if the on-disk HTML still contains /pilot, the old hq jpg, or
 *     is missing the live hero image / book-demo CTA link
 *
 * Modes:
 *   --check    CSV-only validation, NO DB access, NO writes. Exits 0 if the CSV
 *              has exactly 20 valid emails. Safe smoke test.
 *   (default)  DRY RUN — evaluates the 20 vs the DB, logs dry_run, sends nothing.
 *   --send     LIVE — only with the env arming + confirm token above.
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { dealerProspects, outreachSends } from '../src/lib/db/schema'
import {
  cooldownStart,
  evaluateEligibility,
  normalizeEmail,
  sendEnabled,
} from '../src/lib/outreach/eligibility'
import {
  getTemplateByKey,
  syncDefaultTemplateByKey,
  hasBusinessAddress,
} from '../src/lib/outreach/templates'
import { isSuppressed, sendMonthlyInvite } from '../src/lib/outreach/send'

const TEMPLATE_KEY = 'dlr_pilot_invite_v2_hero_hybrid' // bookkeeping-only row; content below is the source of truth
const EMAIL_FILE_PATH = path.join(process.cwd(), 'public', 'email', 'DLR Pilot Invite - EMAIL.html')
const REQUIRED_SUBJECT = '30-day free pilot for Utah dealerships'
const REQUIRED_HERO_IMAGE_URL = 'https://dlr-sms.com/email/dlr-email-hero.png'
const REQUIRED_CTA_URL = 'https://dlr-sms.com/book-demo'
const FORBIDDEN_OLD_IMAGE = 'dlr-free-pilot-email-v2-hq.jpg'
const EXPECTED_TARGET_COUNT = 20
const REQUIRED_CONFIRM = 'SEND_20_DLR_BATCH2_PILOT_EMAILS'
const DEFAULT_CSV = 'outputs/utah_county_dealer_prospects_batch_2_ALL20_IMPORT.csv'
const ACTOR = { id: 'script:outreach-batch2-all20', email: 'brian@dlr-sms.com' }

// Minimal plain-text fallback (Resend wants a text part). The HTML file is the
// thing under test; this mirrors its real content/links.
const EMAIL_TEXT = [
  'DLR — 30-day free pilot for Utah dealerships.',
  '',
  'Claim your 30-day free pilot: https://dlr-sms.com/book-demo',
  '',
  'Or just reply to this email — it comes straight to me. — Brian',
  '',
  'If this is not a fit, reply "no" and we will not follow up.',
].join('\n')

function pipe(s: string | null | undefined): string {
  return (s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').trim()
}

function parseArgs() {
  const args = process.argv.slice(2)
  const csvIdx = args.indexOf('--csv')
  const csv =
    csvIdx >= 0 && args[csvIdx + 1] && !args[csvIdx + 1].startsWith('--')
      ? args[csvIdx + 1]
      : DEFAULT_CSV
  return { csv, requireSend: args.includes('--send'), checkOnly: args.includes('--check') }
}

/** Load the ALL20 import CSV → normalized email set from the publicEmail column. */
function loadEmails(csvPath: string): { emails: Set<string>; rowCount: number } {
  const raw = fs.readFileSync(path.resolve(csvPath), 'utf8')
  const parsed = Papa.parse<Record<string, string>>(raw.trim(), { header: true, skipEmptyLines: true })
  const emails = new Set<string>()
  let rowCount = 0
  for (const row of parsed.data) {
    if (!(row.dealershipName ?? '').trim()) continue
    rowCount++
    const email = normalizeEmail(row.publicEmail)
    if (email && email.includes('@')) emails.add(email)
  }
  return { emails, rowCount }
}

/** Read the send-ready HTML file VERBATIM. Never a DB template. */
function loadEmailHtml(): string {
  return fs.readFileSync(EMAIL_FILE_PATH, 'utf8')
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

type Prospect = typeof dealerProspects.$inferSelect
type Eval = { eligible: boolean; reason: string; detail: string }

async function evaluateProspect(p: Prospect, now: Date): Promise<Eval> {
  const sent30 = await sentWithinCooldown(p.id, now)
  const base = evaluateEligibility(
    {
      id: p.id,
      dealershipName: p.dealershipName,
      publicEmail: p.publicEmail,
      sourceUrl: p.sourceUrl,
      status: p.status,
      archivedAt: p.archivedAt,
      doNotContactAt: p.doNotContactAt,
      nextEligibleAt: p.nextEligibleAt,
    },
    { now, sentWithinCooldown: sent30 },
  )
  if (!base.eligible) return base
  const email = normalizeEmail(p.publicEmail)
  if (email && (await isSuppressed(email))) {
    return { eligible: false, reason: 'suppressed', detail: 'Email or domain is on the suppression list.' }
  }
  return { eligible: true, reason: 'eligible', detail: 'Eligible to send.' }
}

async function main() {
  const { csv, requireSend, checkOnly } = parseArgs()

  // ── 1. CSV scope: bounds everything below. ──
  const { emails, rowCount } = loadEmails(csv)
  console.log(`CSV=${csv}`)
  console.log(`CSV_ROWS=${rowCount}`)
  console.log(`CSV_UNIQUE_EMAILS=${emails.size}`)

  if (emails.size !== EXPECTED_TARGET_COUNT) {
    console.error(`Refusing: CSV must contain exactly ${EXPECTED_TARGET_COUNT} unique emails, found ${emails.size}.`)
    process.exit(1)
  }

  if (checkOnly) {
    console.log('CHECK_OK=true')
    console.log(`Batch 2 email scope (${emails.size}):`)
    for (const e of [...emails].sort()) console.log(`  - ${e}`)
    process.exit(0)
  }

  // ── 2. Email source: VERBATIM file read + structural verification. ──
  console.log(`EMAIL_SOURCE_FILE=${EMAIL_FILE_PATH}`)
  const emailHtml = loadEmailHtml()
  console.log(`EMAIL_SOURCE_BYTES=${Buffer.byteLength(emailHtml, 'utf8')}`)

  const ctaUrls = [...emailHtml.matchAll(/href="([^"]+)"/g)].map(m => m[1])
  console.log('CTA_URLS_FOUND=' + JSON.stringify(ctaUrls))

  const htmlChecks = {
    hasHeroImage: emailHtml.includes(REQUIRED_HERO_IMAGE_URL),
    hasBookDemoCta: emailHtml.includes(REQUIRED_CTA_URL),
    noOldHqImage: !emailHtml.includes(FORBIDDEN_OLD_IMAGE),
    noPilotPath: !emailHtml.includes('/pilot'),
    noMailtoOnHero: !/<a href="mailto:[^"]*"[^>]*>\s*<img/.test(emailHtml),
  }
  console.log('EMAIL_HTML_CHECKS=' + JSON.stringify(htmlChecks))
  if (Object.values(htmlChecks).some(v => !v)) {
    console.error('Refusing: public/email/DLR Pilot Invite - EMAIL.html failed structural verification.')
    process.exit(1)
  }

  // Default to DRY RUN. Real sending requires BOTH --send and the env arm.
  if (!requireSend) process.env.OUTREACH_SEND_ENABLED = 'false'
  const now = new Date()

  if (requireSend && !sendEnabled()) {
    console.error('Refusing: --send passed but OUTREACH_SEND_ENABLED is not "true".')
    process.exit(1)
  }
  if (requireSend && !hasBusinessAddress()) {
    console.error('Refusing: OUTREACH_BUSINESS_ADDRESS is not set — required for the CAN-SPAM footer.')
    process.exit(1)
  }
  if (requireSend && process.env.CONFIRM_DLR_BATCH2_SEND !== REQUIRED_CONFIRM) {
    console.error(`Refusing: set CONFIRM_DLR_BATCH2_SEND=${REQUIRED_CONFIRM} to allow the Batch 2 live send.`)
    process.exit(1)
  }

  // Bookkeeping-only row — never rendered, never sent. Only its `id` is used
  // so outreach_sends.templateId has something stable to point at.
  await syncDefaultTemplateByKey(TEMPLATE_KEY)
  const tpl = await getTemplateByKey(TEMPLATE_KEY)
  if (!tpl) {
    console.error(`Template not found: ${TEMPLATE_KEY}`)
    process.exit(1)
  }

  // ── 3. Match CSV emails against dealer_prospects. Select the whole small
  // table once, then filter to the CSV email set — targets can NEVER be
  // anything outside `emails`. ──
  const all = await db.select().from(dealerProspects)
  const matched = all.filter(p => emails.has(normalizeEmail(p.publicEmail)))
  const matchedEmails = new Set(matched.map(p => normalizeEmail(p.publicEmail)))
  const notImported = [...emails].filter(e => !matchedEmails.has(e)).sort()

  // ── 4. Evaluate every matched prospect and print the target table. ──
  console.log('\nBATCH2_TARGETS')
  console.log('| Dealership | Email | Status | Eligible | Reason |')
  console.log('|---|---|---|---|---|')
  const evals: Array<{ p: Prospect; ev: Eval }> = []
  for (const p of matched.sort((a, b) => (a.dealershipName ?? '').localeCompare(b.dealershipName ?? ''))) {
    const ev = await evaluateProspect(p, now)
    evals.push({ p, ev })
    console.log(
      `| ${pipe(p.dealershipName)} | ${pipe(p.publicEmail)} | ${pipe(p.status)} | ${ev.eligible ? 'eligible' : 'skipped'} | ${ev.eligible ? '-' : ev.reason} |`,
    )
  }

  // ── Dry-run summary counts requested for Batch 2. ──
  const cooldownCount = evals.filter(e => e.ev.reason === 'in_cooldown').length
  const suppressionCount = evals.filter(e => e.ev.reason === 'suppressed').length
  const otherSkips = evals.filter(e => !e.ev.eligible && !['in_cooldown', 'suppressed'].includes(e.ev.reason))
  const sendable = evals.filter(e => e.ev.eligible).length

  console.log('\nSUMMARY=' + JSON.stringify({
    csvTargets: emails.size,
    importedMatched: matched.length,
    notImported: notImported.length,
    skippedCooldown: cooldownCount,
    skippedSuppression: suppressionCount,
    skippedOther: otherSkips.length,
    sendable,
  }))
  if (notImported.length) console.log('NOT_IMPORTED=' + JSON.stringify(notImported))
  if (cooldownCount) {
    console.log('COOLDOWN_BLOCKED=' + JSON.stringify(
      evals.filter(e => e.ev.reason === 'in_cooldown').map(e => `${e.p.dealershipName} <${e.p.publicEmail}>`),
    ))
  }
  if (otherSkips.length) {
    console.log('OTHER_SKIPS=' + JSON.stringify(
      otherSkips.map(e => `${e.p.dealershipName}: ${e.ev.reason}`),
    ))
  }
  console.log('\nWOULD_RECEIVE_EMAIL=' + JSON.stringify(
    evals.filter(e => e.ev.eligible).map(e => `${e.p.dealershipName} <${e.p.publicEmail}>`),
  ))
  console.log(`SUBJECT=${REQUIRED_SUBJECT}`)

  // ── LIVE guard: every one of the 20 must be imported/matched first. ──
  if (requireSend && matched.length !== EXPECTED_TARGET_COUNT) {
    console.error(
      `\nRefusing live send: expected all ${EXPECTED_TARGET_COUNT} imported, matched ${matched.length}.` +
        (notImported.length ? ` Import these first: ${notImported.join(', ')}` : ''),
    )
    process.exit(1)
  }

  console.log(`\nMODE=${requireSend ? 'LIVE SEND ARMED' : 'DRY RUN ONLY'}`)
  console.log(`TEMPLATE_SOURCE=${EMAIL_FILE_PATH}`)
  console.log(`TARGETS=${matched.length}  SENDABLE=${sendable}`)

  let sent = 0, dryRunLogged = 0, skipped = 0, failed = 0
  const reasons = new Map<string, number>()
  for (const { p } of evals) {
    // Final structural guard — never send to anything outside the CSV scope.
    if (!emails.has(normalizeEmail(p.publicEmail))) continue
    const outcome = await sendMonthlyInvite(p.id, TEMPLATE_KEY, ACTOR, {
      override: { subject: REQUIRED_SUBJECT, text: EMAIL_TEXT, html: emailHtml },
    })
    const reason = outcome.ok ? outcome.kind : outcome.reason
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    if (outcome.ok && outcome.kind === 'sent') sent++
    else if (!outcome.ok && outcome.kind === 'dry_run') dryRunLogged++
    else if (!outcome.ok && outcome.kind === 'skipped') skipped++
    else if (!outcome.ok && outcome.kind === 'failed') failed++
  }

  console.log('\nRESULTS=' + JSON.stringify({
    attempted: evals.length, sent, dryRunLogged, skipped, failed,
    reasons: Object.fromEntries([...reasons.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  }))

  console.log(
    `\nLIVE_SEND_COMMAND=OUTREACH_BUSINESS_ADDRESS="1347 W Fort Rock Dr, Saratoga Springs, UT 84045" ` +
      `CONFIRM_DLR_BATCH2_SEND=${REQUIRED_CONFIRM} OUTREACH_SEND_ENABLED=true ` +
      `npx tsx scripts/send-outreach-batch2-all20.ts --send`,
  )
}

main().catch(err => {
  console.error('send-outreach-batch2-all20 failed:', err)
  process.exit(1)
})

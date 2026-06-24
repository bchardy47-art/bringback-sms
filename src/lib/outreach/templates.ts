/**
 * Outreach email templates — defaults, merge-field rendering, and an
 * idempotent "seed if empty" helper.
 *
 * Templates live in the `outreach_templates` table so Brian can edit them, but
 * the canonical defaults are defined here in code so a fresh DB (or a dropped
 * row) always has working copy. ensureDefaultTemplates() upserts any missing
 * default by key — it never overwrites an edited row.
 *
 * For V1 only `what_is_dlr` is wired to sending; the others are seeded for
 * preview. Merge fields supported: {{dealershipName}}, {{contactFirstNameOrTeam}},
 * {{personalizationLine}}, {{businessContactFooter}}, {{ctaUrl}}.
 */

import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { outreachTemplates, dealerProspects } from '@/lib/db/schema'

type Prospect = typeof dealerProspects.$inferSelect

// Business identity shown in the footer of every marketing email (CAN-SPAM:
// accurate sender + physical/contact line + opt-out). Update the address here
// once a registered mailing address is finalized.
export const BUSINESS_CONTACT_FOOTER = [
  'Brian — Dead Lead Revival (DLR)',
  'DLR by BCHardy LLC · support@dlr-sms.com',
].join('\n')

const BUSINESS_CONTACT_FOOTER_HTML =
  'Brian — Dead Lead Revival (DLR)<br/>DLR by BCHardy LLC · ' +
  '<a href="mailto:support@dlr-sms.com" style="color:#9ca3af;">support@dlr-sms.com</a>'

/** Public CTA target — the existing /book-demo page. Absolute URL for email. */
export function ctaUrl(): string {
  const base = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? 'https://dlr-sms.com'
  return `${base.replace(/\/$/, '')}/book-demo`
}

export type DefaultTemplate = {
  key: string
  name: string
  description: string
  subject: string
  previewText: string
  bodyText: string
  /** When false, seeded but not offered for real sending (preview-only). */
  isActive: boolean
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: 'what_is_dlr',
    name: 'What is DLR?',
    description: 'First monthly demo invite. The only template wired to real sending in V1.',
    subject: 'Quick idea for reviving old leads at {{dealershipName}}',
    previewText: 'Wake up the aged leads you already paid for and book more appointments.',
    isActive: true,
    bodyText: [
      'Hi {{contactFirstNameOrTeam}},',
      '',
      "I'm Brian with Dead Lead Revival.",
      '',
      'DLR helps dealerships reconnect with aged, missed, or inactive leads so your',
      'team can turn interested replies back into appointments.',
      '',
      "I'm opening a small number of free pilot/demo slots for dealerships and",
      'thought {{dealershipName}} could be a good fit.',
      '',
      'The basic idea:',
      '- plug into your existing lead process',
      '- wake up old leads you already paid for',
      '- surface real replies for your team',
      '- help book more appointments without replacing your CRM',
      '',
      'Would you be open to a quick demo? {{ctaUrl}}',
      '',
      'Brian',
      'Dead Lead Revival',
      '{{businessContactFooter}}',
      'Reply "not interested" and I won\'t follow up.',
    ].join('\n'),
  },
  {
    key: 'free_pilot_offer',
    name: 'Free Pilot Offer',
    description: 'Angle: Brian is looking for a small number of pilot dealerships. Preview-only in V1.',
    subject: 'A few free DLR pilot slots — is {{dealershipName}} interested?',
    previewText: 'Looking for a handful of dealerships to run a free revival pilot.',
    isActive: false,
    bodyText: [
      'Hi {{contactFirstNameOrTeam}},',
      '',
      "I'm Brian with Dead Lead Revival. I'm taking on a small number of dealerships",
      'for a free pilot this month and {{dealershipName}} stood out.',
      '',
      'A pilot is simple: we take a slice of your aged/dead leads, wake them up with',
      'compliant SMS, and hand your team the ones that reply with real interest. No',
      'CRM rip-and-replace, no long contract.',
      '',
      'Want one of the slots? {{ctaUrl}}',
      '',
      'Brian',
      'Dead Lead Revival',
      '{{businessContactFooter}}',
      'Reply "not interested" and I won\'t follow up.',
    ].join('\n'),
  },
  {
    key: 'follow_up_bump',
    name: 'Follow-up Bump',
    description: 'One short follow-up, still respecting the monthly limit. Preview-only in V1.',
    subject: 'Following up — reviving old leads at {{dealershipName}}',
    previewText: 'Just bumping my note about a free DLR demo.',
    isActive: false,
    bodyText: [
      'Hi {{contactFirstNameOrTeam}},',
      '',
      'Quick bump on my last note — I help dealerships revive aged leads and book',
      "more appointments from leads you've already paid for.",
      '',
      "If now isn't the time, no problem. If you're curious, a short demo is here:",
      '{{ctaUrl}}',
      '',
      'Brian',
      'Dead Lead Revival',
      '{{businessContactFooter}}',
      'Reply "not interested" and I won\'t follow up.',
    ].join('\n'),
  },
]

// ── Merge-field rendering ────────────────────────────────────────────────────

function firstNameOrTeam(p: Pick<Prospect, 'bestContactName' | 'dealershipName'>): string {
  const name = (p.bestContactName ?? '').trim()
  if (name) return name.split(/\s+/)[0]
  return `${(p.dealershipName ?? '').trim()} team`.trim() || 'team'
}

export type RenderVars = {
  dealershipName: string
  contactFirstNameOrTeam: string
  personalizationLine: string
  businessContactFooter: string
  ctaUrl: string
}

export function buildRenderVars(p: Prospect): RenderVars {
  return {
    dealershipName: (p.dealershipName ?? '').trim() || 'your dealership',
    contactFirstNameOrTeam: firstNameOrTeam(p),
    personalizationLine: (p.personalizationLine ?? '').trim(),
    businessContactFooter: BUSINESS_CONTACT_FOOTER,
    ctaUrl: ctaUrl(),
  }
}

function applyVars(str: string, vars: RenderVars): string {
  return str
    .replace(/\{\{\s*dealershipName\s*\}\}/g, vars.dealershipName)
    .replace(/\{\{\s*contactFirstNameOrTeam\s*\}\}/g, vars.contactFirstNameOrTeam)
    .replace(/\{\{\s*personalizationLine\s*\}\}/g, vars.personalizationLine)
    .replace(/\{\{\s*businessContactFooter\s*\}\}/g, vars.businessContactFooter)
    .replace(/\{\{\s*ctaUrl\s*\}\}/g, vars.ctaUrl)
}

export type RenderedEmail = {
  subject: string
  text: string
  html: string
}

/** Render a stored template against a prospect into subject/text/html. */
export function renderTemplate(
  tpl: typeof outreachTemplates.$inferSelect,
  prospect: Prospect,
): RenderedEmail {
  const vars = buildRenderVars(prospect)
  const subject = applyVars(tpl.subject, vars)
  const text = applyVars(tpl.bodyText, vars)
  const html = tpl.bodyHtml
    ? applyVars(tpl.bodyHtml, vars)
    : buildHtmlFromText(subject, text, vars)
  return { subject, text, html }
}

// Email-safe HTML built from the plain-text body when a template has no custom
// HTML. Black/red DLR brand, short bullets, CTA button — never one big image.
function buildHtmlFromText(subject: string, _text: string, vars: RenderVars): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const personalization = vars.personalizationLine
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${esc(vars.personalizationLine)}</p>`
    : ''
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0a0a0a;margin:0;padding:24px;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #1a1a1a;">
    <div style="background:#0a0a0a;padding:22px 28px;border-bottom:3px solid #dc2626;">
      <p style="margin:0;font-size:11px;font-weight:700;color:#dc2626;letter-spacing:0.18em;text-transform:uppercase;">Dead Lead Revival</p>
      <h1 style="margin:6px 0 0;font-size:21px;font-weight:800;color:#fff;line-height:1.3;">${esc(subject)}</h1>
    </div>
    <div style="padding:26px 28px;font-size:15px;line-height:1.65;color:#333;">
      <p style="margin:0 0 16px;">Hi ${esc(vars.contactFirstNameOrTeam)},</p>
      ${personalization}
      <p style="margin:0 0 14px;">I'm Brian with <strong>Dead Lead Revival</strong>. DLR helps dealerships reconnect with aged, missed, or inactive leads so your team can turn interested replies back into appointments.</p>
      <p style="margin:0 0 8px;">I'm opening a small number of free pilot/demo slots and thought <strong>${esc(vars.dealershipName)}</strong> could be a good fit. The basic idea:</p>
      <ul style="margin:0 0 20px;padding-left:22px;color:#333;">
        <li style="margin-bottom:6px;">Plug into your existing lead process</li>
        <li style="margin-bottom:6px;">Wake up old leads you already paid for</li>
        <li style="margin-bottom:6px;">Surface real replies for your team</li>
        <li>Book more appointments without replacing your CRM</li>
      </ul>
      <p style="margin:24px 0;text-align:center;">
        <a href="${esc(vars.ctaUrl)}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:10px;">Book a DLR Demo</a>
      </p>
      <p style="margin:0 0 6px;color:#555;">Brian<br/>Dead Lead Revival</p>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f0f0f0;background:#fafafa;">
      <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;">${BUSINESS_CONTACT_FOOTER_HTML}</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Reply &ldquo;not interested&rdquo; and I won't follow up.</p>
    </div>
  </div>
</body>
</html>`
}

// ── Seed ─────────────────────────────────────────────────────────────────────

/**
 * Insert any default template whose key is missing. Idempotent and safe to call
 * on every outreach page load — it only inserts what's absent and never edits
 * an existing (possibly Brian-customized) row.
 */
export async function ensureDefaultTemplates(): Promise<void> {
  try {
    const existing = await db
      .select({ key: outreachTemplates.key })
      .from(outreachTemplates)
    const have = new Set(existing.map(r => r.key))
    const missing = DEFAULT_TEMPLATES.filter(t => !have.has(t.key))
    if (missing.length === 0) return
    await db.insert(outreachTemplates).values(
      missing.map(t => ({
        key: t.key,
        name: t.name,
        description: t.description,
        subject: t.subject,
        previewText: t.previewText,
        bodyText: t.bodyText,
        bodyHtml: null,
        isActive: t.isActive,
        createdByEmail: 'system',
      })),
    )
  } catch {
    // Best-effort seed — never block a page render if the table is missing.
  }
}

export async function getTemplateByKey(
  key: string,
): Promise<typeof outreachTemplates.$inferSelect | null> {
  const row = await db
    .select()
    .from(outreachTemplates)
    .where(eq(outreachTemplates.key, key))
    .limit(1)
  return row[0] ?? null
}

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

/**
 * Real physical business mailing address shown in the email footer, sourced from
 * OUTREACH_BUSINESS_ADDRESS. CAN-SPAM requires a valid postal address in every
 * marketing email. Returns null when unset/blank — callers MUST fail safe and
 * block live sends (see send.ts) so a placeholder address never goes out.
 */
export function businessAddress(): string | null {
  const v = process.env.OUTREACH_BUSINESS_ADDRESS?.trim()
  return v ? v : null
}

/** True when a real footer address is configured. Required for live sends. */
export function hasBusinessAddress(): boolean {
  return businessAddress() !== null
}

// Branded, email-safe HTML for the "Red Revival" pilot invite. The approved DLR
// hero image (hosted JPG over HTTPS) sits at the top, wrapped in a link to the
// /book-demo page. Everything below it — intro copy, the "Book My Free Demo"
// button, sign-off, and compliance footer — is real HTML text on a black
// background (never an image-only email, no background images). Responsive via a
// single media query. Merge fields: {{dealershipName}}, {{contactFirstNameOrTeam}},
// {{businessAddress}}.
const RED_REVIVAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark light" />
<meta name="supported-color-schemes" content="dark light" />
<title>Dead Lead Revival</title>
<style>
  @media only screen and (max-width:600px){
    .dlr-container{width:100% !important;}
    .dlr-pad{padding-left:24px !important;padding-right:24px !important;}
    .dlr-cta a{display:block !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#000000;background-color:#000000;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#000000;opacity:0;">DLR helps dealerships reconnect with old leads they already paid for.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color:#000000;background-image:radial-gradient(circle at 50% 0%, #3a0a0a 0%, #000000 60%);">
    <tr>
      <td align="center" style="padding:24px 12px 34px;">
        <table role="presentation" class="dlr-container" width="700" cellpadding="0" cellspacing="0" border="0" style="width:700px;max-width:700px;background-color:#0a0a0a;border:1px solid #ff2a2a;border-radius:16px;box-shadow:0 0 46px rgba(255,42,42,0.38);overflow:hidden;">

          <tr>
            <td align="center" style="padding:0;line-height:0;font-size:0;">
              <a href="https://dlr-sms.com/book-demo" style="display:block;text-decoration:none;border:0;">
                <img src="https://dlr-sms.com/email/dlr-pilot-hero-v1.jpg" width="700" alt="Ready to revive your dead leads? Book your free DLR demo." style="width:100%; max-width:700px; display:block; border:0;" />
              </a>
            </td>
          </tr>

          <tr>
            <td class="dlr-pad" style="padding:30px 40px 6px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#d6d6d6;">
              <p style="margin:0 0 18px;">Hi {{contactFirstNameOrTeam}} &mdash; I'm <strong style="color:#ffffff;">Brian Hardy</strong>, local here in Utah. I'm opening a small free pilot for a few dealerships to see if DLR actually works in a real store. If you'd be open to a quick look, book a free demo below.</p>
            </td>
          </tr>

          <tr>
            <td class="dlr-pad" align="center" style="padding:10px 40px 6px;">
              <table role="presentation" class="dlr-cta" cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td align="center" bgcolor="#ff2a2a" style="border-radius:12px;box-shadow:0 0 26px rgba(255,42,42,0.6);">
                    <a href="https://dlr-sms.com/book-demo" style="display:inline-block;padding:17px 44px;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#ffffff;text-decoration:none;text-transform:uppercase;letter-spacing:0.5px;border-radius:12px;">&#9889; Book My Free Demo</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td class="dlr-pad" align="center" style="padding:4px 40px 22px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8a8a8a;">Or just reply to this email and we'll find a time.</td></tr>

          <tr>
            <td class="dlr-pad" style="padding:4px 40px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#d6d6d6;">
              <p style="margin:0;">Talk soon,</p>
              <p style="margin:4px 0 0;color:#ffffff;font-weight:bold;">Brian Hardy</p>
              <p style="margin:2px 0 0;color:#9a9a9a;font-size:13px;">Dead Lead Revival &middot; <a href="mailto:brian@dlr-sms.com" style="color:#ff2a2a;text-decoration:none;">brian@dlr-sms.com</a></p>
            </td>
          </tr>

          <tr>
            <td class="dlr-pad" style="padding:18px 40px 26px;background-color:#050505;border-top:1px solid #1f1f1f;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6b6b6b;">
              <p style="margin:0 0 8px;">You're receiving this one-time invitation because {{dealershipName}} is an independent dealership that may be a fit for DLR. This is a personal outreach email, not a subscription.</p>
              <p style="margin:0 0 8px;"><strong style="color:#9a9a9a;">Not interested?</strong> Just reply &ldquo;no&rdquo; and I won't follow up &mdash; or <a href="mailto:brian@dlr-sms.com?subject=Unsubscribe" style="color:#9a9a9a;text-decoration:underline;">unsubscribe here</a>. You won't hear from me again.</p>
              <p style="margin:0;color:#5a5a5a;">DLR by BCHardy LLC &middot; {{businessAddress}} &middot; <a href="mailto:support@dlr-sms.com" style="color:#6b6b6b;">support@dlr-sms.com</a></p>
            </td>
          </tr>
        </table>
        <table role="presentation" class="dlr-container" width="700" cellpadding="0" cellspacing="0" border="0" style="width:700px;max-width:700px;">
          <tr><td align="center" style="padding:16px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#4a4a4a;">&copy; BCHardy LLC &middot; Saratoga Springs, Utah</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

export type DefaultTemplate = {
  key: string
  name: string
  description: string
  subject: string
  previewText: string
  bodyText: string
  /** When false, seeded but not offered for real sending (preview-only). */
  isActive: boolean
  /**
   * Optional custom email-safe HTML. When present it's stored on the row and
   * used verbatim (after merge-field substitution) instead of the generated
   * default HTML. Must be table-based + inline-styled for email clients.
   */
  bodyHtml?: string | null
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: 'dlr_pilot_invite_v1_red_revival',
    name: 'DLR Pilot Invite v1 - Red Revival',
    description:
      'Branded black/red pilot invite. Approved DLR hero image (hosted JPG) at the top linked to ' +
      '/book-demo, real HTML intro + "Book My Free Demo" button + compliance footer. CTA: dlr-sms.com/book-demo. Active.',
    subject: '{{dealershipName}} — want to test DLR free for 30 days?',
    previewText: 'DLR helps dealerships reconnect with old leads they already paid for.',
    isActive: true,
    bodyText: [
      'Ready to revive your dead leads? Book your free DLR demo:',
      'https://dlr-sms.com/book-demo',
      '',
      "Hi {{contactFirstNameOrTeam}} — I'm Brian Hardy, local here in Utah. I'm opening a",
      'small free pilot for a few dealerships to see if DLR actually works in a real',
      "store. If you'd be open to a quick look, book a free demo below.",
      '',
      '⚡ Book My Free Demo:',
      'https://dlr-sms.com/book-demo',
      '',
      "Or just reply to this email and we'll find a time.",
      '',
      'Talk soon,',
      'Brian Hardy',
      'Dead Lead Revival · brian@dlr-sms.com',
      '',
      '—',
      "You're receiving this one-time invitation because {{dealershipName}} is an independent",
      'dealership that may be a fit for DLR. This is a personal outreach email, not a subscription.',
      'Not interested? Reply "no" and I won\'t follow up — or email brian@dlr-sms.com with "unsubscribe". You won\'t hear from me again.',
      'DLR by BCHardy LLC · {{businessAddress}} · support@dlr-sms.com',
    ].join('\n'),
    bodyHtml: RED_REVIVAL_HTML,
  },
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
  businessAddress: string
  ctaUrl: string
}

export function buildRenderVars(p: Prospect): RenderVars {
  return {
    dealershipName: (p.dealershipName ?? '').trim() || 'your dealership',
    contactFirstNameOrTeam: firstNameOrTeam(p),
    personalizationLine: (p.personalizationLine ?? '').trim(),
    businessContactFooter: BUSINESS_CONTACT_FOOTER,
    businessAddress: businessAddress() ?? '',
    ctaUrl: ctaUrl(),
  }
}

function applyVars(str: string, vars: RenderVars): string {
  return str
    .replace(/\{\{\s*dealershipName\s*\}\}/g, vars.dealershipName)
    .replace(/\{\{\s*contactFirstNameOrTeam\s*\}\}/g, vars.contactFirstNameOrTeam)
    .replace(/\{\{\s*personalizationLine\s*\}\}/g, vars.personalizationLine)
    .replace(/\{\{\s*businessContactFooter\s*\}\}/g, vars.businessContactFooter)
    .replace(/\{\{\s*businessAddress\s*\}\}/g, vars.businessAddress)
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
        bodyHtml: t.bodyHtml ?? null,
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

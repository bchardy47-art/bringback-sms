/**
 * Revival alerting — fires once per conversation when an enrolled lead replies.
 *
 * Channels:
 *   SMS  — sent via existing Telnyx provider to every manager/admin phone
 *   Email — sent via nodemailer if SMTP_URL + EMAIL_FROM are configured
 *
 * Dedup: guarded by conversations.revivedAlertSentAt so retries are idempotent.
 */

import { and, desc, eq, inArray } from 'drizzle-orm'
import nodemailer from 'nodemailer'
import { db } from '@/lib/db'
import { conversations, leads, messages, users } from '@/lib/db/schema'
import { getProvider } from '@/lib/messaging'

// ── helpers ──────────────────────────────────────────────────────────────────

function appUrl(): string {
  return process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? 'https://app.dlr.ai'
}

function shortPreview(body: string, maxLen = 120): string {
  const clean = body.replace(/\s+/g, ' ').trim()
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean
}

// ── SMS ───────────────────────────────────────────────────────────────────────

async function sendSmsAlert(params: {
  toPhone: string
  tenantPhone: string
  leadFirstName: string
  leadLastName: string
  vehicle: string | null
  replyPreview: string
  conversationId: string
}): Promise<void> {
  const { toPhone, tenantPhone, leadFirstName, leadLastName, vehicle, replyPreview, conversationId } = params
  const vehiclePart = vehicle ? ` re: ${vehicle}` : ''
  const link = `${appUrl()}/inbox/${conversationId}`

  const body =
    `🔔 DLR: ${leadFirstName} ${leadLastName} just replied${vehiclePart}.\n` +
    `"${replyPreview}"\n` +
    `Take over: ${link}`

  try {
    const provider = getProvider()
    await provider.send({ from: tenantPhone, to: toPhone, body })
    console.log(`[alerts] SMS sent to manager ${toPhone} for conversation ${conversationId}`)
  } catch (err) {
    console.error(`[alerts] SMS failed for ${toPhone}:`, err)
  }
}

// ── Email ─────────────────────────────────────────────────────────────────────

function buildEmailHtml(params: {
  leadFirstName: string
  leadLastName: string
  vehicle: string | null
  phone: string
  replyPreview: string
  conversationId: string
}): string {
  const { leadFirstName, leadLastName, vehicle, phone, replyPreview, conversationId } = params
  const link = `${appUrl()}/inbox/${conversationId}`
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:#dc2626;padding:20px 24px;">
      <p style="margin:0;color:white;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;">DLR — Dead Lead Revival</p>
      <h1 style="margin:4px 0 0;color:white;font-size:22px;font-weight:700;">🔔 Reviving Lead</h1>
    </div>
    <div style="padding:24px;">
      <h2 style="margin:0 0 4px;font-size:18px;color:#111;">${leadFirstName} ${leadLastName}</h2>
      ${vehicle ? `<p style="margin:0 0 12px;font-size:13px;color:#6b7280;">${vehicle}</p>` : ''}
      <p style="margin:0 0 16px;font-size:13px;color:#6b7280;">${phone}</p>
      <div style="background:#f9fafb;border-left:3px solid #dc2626;border-radius:4px;padding:12px 16px;margin:0 0 24px;">
        <p style="margin:0;font-size:14px;color:#374151;font-style:italic;">"${replyPreview}"</p>
      </div>
      <a href="${link}" style="display:inline-block;background:#dc2626;color:white;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">
        Take Over Conversation →
      </a>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #f0f0f0;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">DLR automatically monitors your stale leads and alerts you only when one is genuinely reviving.</p>
    </div>
  </div>
</body>
</html>`
}

async function sendEmailAlert(params: {
  toEmail: string
  toName: string
  leadFirstName: string
  leadLastName: string
  vehicle: string | null
  phone: string
  replyPreview: string
  conversationId: string
  subjectOverride?: string
  htmlOverride?: string
}): Promise<void> {
  const smtpUrl = process.env.SMTP_URL
  const emailFrom = process.env.EMAIL_FROM

  if (!smtpUrl || !emailFrom) {
    // Email not configured — skip silently (SMS is primary channel)
    return
  }

  try {
    const transporter = nodemailer.createTransport(smtpUrl)
    const vehicleLabel = params.vehicle ?? 'a vehicle'
    await transporter.sendMail({
      from: `DLR Alerts <${emailFrom}>`,
      to: `${params.toName} <${params.toEmail}>`,
      subject: params.subjectOverride ?? `Reviving Lead: ${params.leadFirstName} ${params.leadLastName} — ${vehicleLabel}`,
      html: params.htmlOverride ?? buildEmailHtml(params),
    })
    console.log(`[alerts] Email sent to ${params.toEmail} for conversation ${params.conversationId}`)
  } catch (err) {
    console.error(`[alerts] Email failed for ${params.toEmail}:`, err)
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function sendRevivalAlert(conversationId: string): Promise<void> {
  // 1. Load conversation + lead
  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
    with: { lead: true },
  })
  if (!conv) return

  // 2. Dedup: only fire once per conversation
  if (conv.revivedAlertSentAt) {
    console.log(`[alerts] Alert already sent for conversation ${conversationId} — skipping`)
    return
  }

  // 3. Find the latest inbound message for the preview
  const lastInbound = await db.query.messages.findFirst({
    where: and(
      eq(messages.conversationId, conversationId),
      eq(messages.direction, 'inbound')
    ),
    orderBy: [desc(messages.createdAt)],
  })
  const preview = lastInbound ? shortPreview(lastInbound.body) : '(no message body)'

  // 4. Load all managers + admins in this tenant
  const managers = await db.query.users.findMany({
    where: and(
      eq(users.tenantId, conv.tenantId),
      inArray(users.role, ['manager', 'admin'])
    ),
  })

  if (managers.length === 0) {
    console.warn(`[alerts] No managers found for tenant ${conv.tenantId} — skipping alert`)
    return
  }

  const lead = conv.lead

  // 5. Send SMS + email to each manager
  const managersWithPhone = managers.filter(m => m.phone)
  if (managersWithPhone.length === 0) {
    console.warn(
      `[alerts] Revival alert: ${managers.length} manager(s) found for tenant ${conv.tenantId} ` +
      `but NONE have a phone number set — SMS alert will not be sent. ` +
      `Go to Settings and add an alert phone for each manager/admin.`
    )
  } else {
    console.log(`[alerts] Revival alert: sending to ${managersWithPhone.length} of ${managers.length} manager(s) with phone set`)
  }

  await Promise.allSettled(
    managers.flatMap((mgr) => {
      const tasks = []

      if (mgr.phone) {
        tasks.push(
          sendSmsAlert({
            toPhone: mgr.phone,
            tenantPhone: conv.tenantPhone,
            leadFirstName: lead.firstName,
            leadLastName: lead.lastName,
            vehicle: lead.vehicleOfInterest ?? null,
            replyPreview: preview,
            conversationId,
          })
        )
      }

      tasks.push(
        sendEmailAlert({
          toEmail: mgr.email,
          toName: mgr.name,
          leadFirstName: lead.firstName,
          leadLastName: lead.lastName,
          vehicle: lead.vehicleOfInterest ?? null,
          phone: lead.phone,
          replyPreview: preview,
          conversationId,
        })
      )

      return tasks
    })
  )

  // 6. Mark alert sent — idempotency guard for future webhook retries
  await db
    .update(conversations)
    .set({ revivedAlertSentAt: new Date() })
    .where(eq(conversations.id, conversationId))

  console.log(`[alerts] Revival alert dispatched for conversation ${conversationId} (lead: ${lead.firstName} ${lead.lastName})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Handoff alert — fires when a warm/hot lead needs a human to take over.
// Unlike the revival alert this fires every time a NEW handoff task is created
// (dedup is handled upstream by createHandoffTask's duplicate-open-task guard).
// ─────────────────────────────────────────────────────────────────────────────

const CLASSIFICATION_LABELS: Record<string, string> = {
  // Hot — buying now
  hot_appointment:    'Appointment Request 🔥📅',
  hot_payment:        'Ready to Buy 🔥💰',
  hot_inventory:      'Asking About Vehicle 🔥🚗',
  // Warm — engaged
  warm_trade:         'Trade-in Mentioned 🔄',
  warm_finance:       'Finance Inquiry 💳',
  needs_human_review: 'Needs Review 👀',
  // Escalation
  angry_or_complaint: 'Complaint / Angry 🚨',
}

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'URGENT',
  high:   'High',
  normal: 'Normal',
}

function buildHandoffEmailHtml(params: {
  leadFirstName: string
  leadLastName: string
  vehicle: string | null
  phone: string
  classification: string
  priority: string
  customerMessage: string
  recommendedAction: string
  recommendedReply: string | null
  salesSummary: string | null
  conversationId: string
}): string {
  const { leadFirstName, leadLastName, vehicle, phone, classification, priority,
          customerMessage, recommendedAction, recommendedReply, salesSummary, conversationId } = params
  const link = `${appUrl()}/inbox/${conversationId}`
  const classLabel = CLASSIFICATION_LABELS[classification] ?? classification
  const priorityLabel = PRIORITY_LABELS[priority] ?? priority
  const priorityColor = priority === 'urgent' ? '#dc2626' : priority === 'high' ? '#d97706' : '#6b7280'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:#1d4ed8;padding:20px 24px;">
      <p style="margin:0;color:white;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;">DLR — Human Handoff Required</p>
      <h1 style="margin:4px 0 0;color:white;font-size:22px;font-weight:700;">🤝 Lead Ready for Pickup</h1>
    </div>
    <div style="padding:24px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <div>
          <h2 style="margin:0 0 2px;font-size:18px;color:#111;">${leadFirstName} ${leadLastName}</h2>
          ${vehicle ? `<p style="margin:0;font-size:13px;color:#6b7280;">${vehicle}</p>` : ''}
          <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${phone}</p>
        </div>
        <div style="margin-left:auto;text-align:right;">
          <span style="display:inline-block;background:${priorityColor};color:white;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;">${priorityLabel}</span>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${classLabel}</p>
        </div>
      </div>

      <div style="background:#f9fafb;border-left:3px solid #1d4ed8;border-radius:4px;padding:12px 16px;margin:0 0 16px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Customer said</p>
        <p style="margin:0;font-size:14px;color:#374151;font-style:italic;">"${customerMessage}"</p>
      </div>

      ${salesSummary ? `
      <div style="background:#fefce8;border-left:3px solid #ca8a04;border-radius:4px;padding:10px 16px;margin:0 0 16px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#854d0e;text-transform:uppercase;letter-spacing:.05em;">Buyer signals</p>
        <p style="margin:0;font-size:13px;color:#78350f;">${salesSummary}</p>
      </div>` : ''}

      <div style="background:#f0fdf4;border-radius:8px;padding:12px 16px;margin:0 0 24px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#166534;text-transform:uppercase;letter-spacing:.05em;">Recommended action</p>
        <p style="margin:0;font-size:13px;color:#166534;">${recommendedAction}</p>
        ${recommendedReply ? `
        <p style="margin:10px 0 4px;font-size:11px;font-weight:600;color:#166534;text-transform:uppercase;letter-spacing:.05em;">Suggested reply</p>
        <p style="margin:0;font-size:13px;color:#166534;font-style:italic;">"${recommendedReply}"</p>` : ''}
      </div>

      <a href="${link}" style="display:inline-block;background:#1d4ed8;color:white;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">
        Open Conversation →
      </a>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #f0f0f0;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">DLR automation has paused on this lead. Take over the conversation to move forward.</p>
    </div>
  </div>
</body>
</html>`
}

export async function sendHandoffAlert(params: {
  tenantId: string
  conversationId: string
  leadId: string
  classification: string
  priority: string
  customerMessage: string
  recommendedAction: string
  recommendedReply: string | null
  salesSummary?: string | null
}): Promise<void> {
  const { tenantId, conversationId, leadId, classification, priority,
          customerMessage, recommendedAction, recommendedReply,
          salesSummary = null } = params

  // Load conversation + lead
  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
    with: { lead: true },
  })
  if (!conv) {
    console.warn(`[alerts] sendHandoffAlert: conversation ${conversationId} not found`)
    return
  }

  const lead = conv.lead

  // Load all managers + admins in this tenant
  const managers = await db.query.users.findMany({
    where: and(
      eq(users.tenantId, tenantId),
      inArray(users.role, ['manager', 'admin'])
    ),
  })

  if (managers.length === 0) {
    console.warn(`[alerts] No managers found for tenant ${tenantId} — skipping handoff alert`)
    return
  }

  const managersWithPhoneCount = managers.filter(m => m.phone).length
  if (managersWithPhoneCount === 0) {
    console.warn(
      `[alerts] Handoff alert: ${managers.length} manager(s) found for tenant ${tenantId} ` +
      `but NONE have a phone number set — SMS alert will not be sent. ` +
      `Go to Settings → Account and add an alert phone for each manager/admin.`
    )
  } else {
    console.log(`[alerts] Handoff alert: sending to ${managersWithPhoneCount} of ${managers.length} manager(s) with phone set`)
  }

  const classLabel = CLASSIFICATION_LABELS[classification] ?? classification
  const priorityLabel = PRIORITY_LABELS[priority] ?? priority
  const vehiclePart = lead.vehicleOfInterest ? ` re: ${lead.vehicleOfInterest}` : ''
  const link = `${appUrl()}/inbox/${conversationId}`
  const preview = shortPreview(customerMessage)

  await Promise.allSettled(
    managers.flatMap((mgr) => {
      const tasks = []

      // SMS alert
      if (mgr.phone) {
        const smsBody =
          `🤝 DLR Handoff [${priorityLabel}]: ${lead.firstName} ${lead.lastName}${vehiclePart}\n` +
          `Intent: ${classLabel}\n` +
          `"${preview}"\n` +
          (recommendedReply ? `Reply: "${recommendedReply}"\n` : '') +
          `Pickup: ${link}`

        tasks.push(
          (async () => {
            try {
              const provider = getProvider()
              await provider.send({ from: conv.tenantPhone, to: mgr.phone!, body: smsBody })
              console.log(`[alerts] Handoff SMS sent to manager ${mgr.phone} for conversation ${conversationId}`)
            } catch (err) {
              console.error(`[alerts] Handoff SMS failed for ${mgr.phone}:`, err)
            }
          })()
        )
      }

      // Email alert
      tasks.push(
        sendEmailAlert({
          toEmail: mgr.email,
          toName: mgr.name,
          leadFirstName: lead.firstName,
          leadLastName: lead.lastName,
          vehicle: lead.vehicleOfInterest ?? null,
          phone: lead.phone,
          replyPreview: preview,
          conversationId,
          subjectOverride: `Handoff [${priorityLabel}]: ${lead.firstName} ${lead.lastName} — ${classLabel}`,
          htmlOverride: buildHandoffEmailHtml({
            leadFirstName: lead.firstName,
            leadLastName: lead.lastName,
            vehicle: lead.vehicleOfInterest ?? null,
            phone: lead.phone,
            classification,
            priority,
            customerMessage: preview,
            recommendedAction,
            recommendedReply,
            salesSummary,
            conversationId,
          }),
        })
      )

      return tasks
    })
  )

  console.log(`[alerts] Handoff alert dispatched for conversation ${conversationId} (lead: ${lead.firstName} ${lead.lastName}, classification: ${classification})`)
}

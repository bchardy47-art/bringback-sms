/**
 * Phase 12 — Telnyx Configuration Audit
 *
 * Audits all Telnyx-related configuration required for production SMS sending:
 *   - Required environment variables (API key, public key, messaging profile)
 *   - Tenant-level fields (sending number, messaging profile ID, campaign ID)
 *   - Webhook URL expectations (inbound + status callbacks)
 *   - Provider message ID capture confirmation
 *   - 10DLC brand / campaign submission readiness
 *   - Privacy / terms URL presence (required for TCR submission)
 *
 * This is a pure read — no DB writes, no side effects.
 * Results feed into the go/no-go report.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AuditSeverity = 'ok' | 'warning' | 'blocker'

export type AuditCheck = {
  id: string
  label: string
  severity: AuditSeverity
  detail: string
  /** Optional remediation hint shown in the UI */
  hint?: string
}

export type AuditSection = {
  id: string
  title: string
  checks: AuditCheck[]
}

export type TelnyxConfigAuditResult = {
  tenantId: string
  tenantName: string
  generatedAt: string
  blocked: boolean
  blockerCount: number
  warningCount: number
  sections: AuditSection[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(id: string, label: string, detail: string, hint?: string): AuditCheck {
  return { id, label, severity: 'ok', detail, hint }
}
function warn(id: string, label: string, detail: string, hint?: string): AuditCheck {
  return { id, label, severity: 'warning', detail, hint }
}
function blocker(id: string, label: string, detail: string, hint?: string): AuditCheck {
  return { id, label, severity: 'blocker', detail, hint }
}

// ── Section: Environment Variables ────────────────────────────────────────────

function evalEnvSection(): AuditSection {
  const checks: AuditCheck[] = []

  // TELNYX_API_KEY — required for all outbound sends
  if (process.env.TELNYX_API_KEY) {
    checks.push(ok(
      'env_api_key',
      'TELNYX_API_KEY',
      'API key is set — outbound sends are configured',
    ))
  } else {
    checks.push(blocker(
      'env_api_key',
      'TELNYX_API_KEY',
      'TELNYX_API_KEY is not set. No outbound SMS can be sent.',
      'Set TELNYX_API_KEY in your .env.local (dev) or production environment variables.',
    ))
  }

  // TELNYX_PUBLIC_KEY — required for webhook signature verification in production
  if (process.env.TELNYX_PUBLIC_KEY) {
    checks.push(ok(
      'env_public_key',
      'TELNYX_PUBLIC_KEY',
      'Webhook public key is set — Ed25519 signature verification is active in production',
    ))
  } else if (process.env.NODE_ENV === 'production') {
    checks.push(blocker(
      'env_public_key',
      'TELNYX_PUBLIC_KEY',
      'TELNYX_PUBLIC_KEY is not set. Webhook signatures cannot be verified in production — all inbound webhooks will be rejected.',
      'Copy the Ed25519 public key from the Telnyx portal → Messaging → Webhooks → Public Key.',
    ))
  } else {
    checks.push(warn(
      'env_public_key',
      'TELNYX_PUBLIC_KEY',
      'TELNYX_PUBLIC_KEY is not set. Signature verification is skipped in dev/test mode, but required before going to production.',
      'Copy the Ed25519 public key from the Telnyx portal → Messaging → Webhooks → Public Key.',
    ))
  }

  // TELNYX_MESSAGING_PROFILE_ID — env-level default (tenant override preferred)
  if (process.env.TELNYX_MESSAGING_PROFILE_ID) {
    checks.push(ok(
      'env_messaging_profile_id',
      'TELNYX_MESSAGING_PROFILE_ID (env default)',
      `Default messaging profile ID is set: ${process.env.TELNYX_MESSAGING_PROFILE_ID}`,
    ))
  } else {
    checks.push(warn(
      'env_messaging_profile_id',
      'TELNYX_MESSAGING_PROFILE_ID (env default)',
      'No env-level default messaging profile ID. Per-tenant messagingProfileId must be set.',
      'Set this in .env or configure messagingProfileId on each tenant record.',
    ))
  }

  // SMS_LIVE_MODE — required to send real messages
  const isLive = process.env.SMS_LIVE_MODE === 'true'
  if (isLive) {
    checks.push(ok(
      'env_sms_live_mode',
      'SMS_LIVE_MODE',
      'SMS_LIVE_MODE=true — live sends are enabled',
    ))
  } else {
    checks.push(warn(
      'env_sms_live_mode',
      'SMS_LIVE_MODE',
      'SMS_LIVE_MODE is not set to "true". All sends are dry-run / skipped.',
      'Set SMS_LIVE_MODE=true in production when ready to send live messages.',
    ))
  }

  // DATABASE_URL — sanity check
  if (process.env.DATABASE_URL) {
    checks.push(ok('env_database_url', 'DATABASE_URL', 'Database URL is configured'))
  } else {
    checks.push(blocker(
      'env_database_url',
      'DATABASE_URL',
      'DATABASE_URL is not set — the application cannot connect to the database.',
    ))
  }

  // NEXTAUTH_SECRET — required for session security
  if (process.env.NEXTAUTH_SECRET) {
    checks.push(ok('env_nextauth_secret', 'NEXTAUTH_SECRET', 'Auth secret is set'))
  } else {
    checks.push(blocker(
      'env_nextauth_secret',
      'NEXTAUTH_SECRET',
      'NEXTAUTH_SECRET is not set — user sessions are insecure.',
      'Generate a strong random secret and set it in your production environment.',
    ))
  }

  return { id: 'env', title: 'Environment Variables', checks }
}

// ── Section: Tenant Telnyx Fields ─────────────────────────────────────────────

function evalTenantTelnyxSection(
  tenant: typeof tenants.$inferSelect
): AuditSection {
  const checks: AuditCheck[] = []
  const isDevBypass = ['exempt', 'dev_override'].includes(tenant.tenDlcStatus)

  // Sending number
  if (tenant.smsSendingNumber) {
    checks.push(ok(
      'tenant_sending_number',
      'SMS sending number',
      `Configured: ${tenant.smsSendingNumber}`,
    ))
  } else {
    checks.push(blocker(
      'tenant_sending_number',
      'SMS sending number',
      'No SMS sending number assigned to this tenant.',
      'Purchase a Telnyx number and set smsSendingNumber on the tenant record.',
    ))
  }

  // Messaging profile ID
  if (tenant.messagingProfileId) {
    checks.push(ok(
      'tenant_messaging_profile_id',
      'Telnyx messaging profile ID',
      `Configured: ${tenant.messagingProfileId}`,
    ))
  } else if (isDevBypass) {
    checks.push(warn(
      'tenant_messaging_profile_id',
      'Telnyx messaging profile ID',
      'Not set — currently bypassed via dev/exempt mode.',
      'Set messagingProfileId once your Telnyx messaging profile is created.',
    ))
  } else {
    checks.push(blocker(
      'tenant_messaging_profile_id',
      'Telnyx messaging profile ID',
      'Messaging profile ID is required to link your sending number to a Telnyx messaging profile.',
      'Create a messaging profile in Telnyx portal → Messaging → Messaging Profiles, then save the ID here.',
    ))
  }

  // Campaign ID (TCR)
  if (tenant.campaignId) {
    checks.push(ok(
      'tenant_campaign_id',
      'TCR campaign ID',
      `Configured: ${tenant.campaignId}`,
    ))
  } else if (isDevBypass) {
    checks.push(warn(
      'tenant_campaign_id',
      'TCR campaign ID',
      'Not set — currently bypassed via dev/exempt mode.',
      'Record the TCR campaign ID after completing campaign registration.',
    ))
  } else {
    checks.push(warn(
      'tenant_campaign_id',
      'TCR campaign ID',
      'Campaign ID not set. Required after completing TCR campaign registration.',
      'Submit your campaign via Telnyx 10DLC → Campaigns, then save the campaign ID here.',
    ))
  }

  // Brand status
  if (isDevBypass) {
    checks.push(ok('tenant_brand_status', 'TCR brand status', `Bypassed: ${tenant.tenDlcStatus}`))
  } else if (tenant.brandStatus === 'approved') {
    checks.push(ok('tenant_brand_status', 'TCR brand status', 'Brand registration approved'))
  } else if (tenant.brandStatus === 'pending') {
    checks.push(warn(
      'tenant_brand_status',
      'TCR brand status',
      'Brand registration is pending TCR review.',
      'Monitor brand registration status in the Telnyx portal. Approval typically takes 1–3 business days.',
    ))
  } else if (tenant.brandStatus === 'rejected') {
    checks.push(blocker(
      'tenant_brand_status',
      'TCR brand status',
      `Brand registration rejected. Reason: ${tenant.tenDlcRejectionReason ?? 'not specified'}`,
      'Review rejection reason and resubmit. Contact Telnyx support if needed.',
    ))
  } else {
    checks.push(blocker(
      'tenant_brand_status',
      'TCR brand status',
      'Brand status not set. TCR brand registration must be completed before sending.',
      'Submit brand registration via Telnyx 10DLC → Brands.',
    ))
  }

  // Campaign status
  if (isDevBypass) {
    checks.push(ok('tenant_campaign_status', 'TCR campaign status', `Bypassed: ${tenant.tenDlcStatus}`))
  } else if (tenant.campaignStatus === 'approved') {
    checks.push(ok('tenant_campaign_status', 'TCR campaign status', 'Campaign registration approved'))
  } else if (tenant.campaignStatus === 'pending') {
    checks.push(warn(
      'tenant_campaign_status',
      'TCR campaign status',
      'Campaign registration is pending TCR review.',
      'Monitor campaign status in the Telnyx portal. Approval can take 3–10 business days.',
    ))
  } else {
    checks.push(blocker(
      'tenant_campaign_status',
      'TCR campaign status',
      'Campaign status not set. TCR campaign registration must be approved before sending.',
      'Submit campaign registration via Telnyx 10DLC → Campaigns.',
    ))
  }

  return { id: 'tenant_telnyx', title: 'Tenant Telnyx Configuration', checks }
}

// ── Section: Webhook Configuration ────────────────────────────────────────────

function evalWebhookSection(): AuditSection {
  const checks: AuditCheck[] = []

  // Inbound webhook route
  checks.push(ok(
    'webhook_inbound_route',
    'Inbound message route',
    'Route /api/webhooks/telnyx handles message.received events (STOP, classification, handoff)',
  ))

  // Status callback route
  checks.push(ok(
    'webhook_status_route',
    'Delivery status callback route',
    'Route /api/webhooks/telnyx handles message.sent, message.delivered, message.failed events',
  ))

  // Webhook URL (deployment URL must be set)
  const appUrl = process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL
  if (appUrl) {
    const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/webhooks/telnyx`
    checks.push(ok(
      'webhook_url',
      'Webhook URL',
      `Expected URL: ${webhookUrl}`,
      'Confirm this URL is registered in Telnyx → Messaging → Messaging Profiles → Webhooks.',
    ))
  } else {
    checks.push(warn(
      'webhook_url',
      'Webhook URL',
      'NEXTAUTH_URL or VERCEL_URL not set — cannot confirm expected webhook URL.',
      'Set NEXTAUTH_URL in production to enable URL confirmation. Register /api/webhooks/telnyx in Telnyx portal.',
    ))
  }

  // Signature verification
  if (process.env.TELNYX_PUBLIC_KEY) {
    checks.push(ok(
      'webhook_signature',
      'Webhook signature verification',
      'TELNYX_PUBLIC_KEY is set — Ed25519 signatures verified on every webhook in production',
    ))
  } else if (process.env.NODE_ENV !== 'production') {
    checks.push(warn(
      'webhook_signature',
      'Webhook signature verification',
      'Signature verification is bypassed in non-production environments (dev/test mode).',
      'Set TELNYX_PUBLIC_KEY before deploying to production.',
    ))
  } else {
    checks.push(blocker(
      'webhook_signature',
      'Webhook signature verification',
      'Signature verification requires TELNYX_PUBLIC_KEY — any inbound webhook will be rejected in production.',
      'Copy the Ed25519 public key from Telnyx → Messaging → Webhooks → Public Key and set as TELNYX_PUBLIC_KEY.',
    ))
  }

  // Provider message ID capture
  checks.push(ok(
    'provider_message_id',
    'Provider message ID capture',
    'providerMessageId stored on every message row (from Telnyx send response) for status event correlation',
  ))

  // Status event storage
  checks.push(ok(
    'status_event_storage',
    'Delivery status event storage',
    'message_status_events table records each status transition with idempotency guard (STATUS_ORDER ranking)',
  ))

  return { id: 'webhook', title: 'Webhook Configuration', checks }
}

// ── Section: 10DLC Submission Readiness ───────────────────────────────────────

function evalTenDlcSection(
  tenant: typeof tenants.$inferSelect
): AuditSection {
  const checks: AuditCheck[] = []

  // Business legal name
  if (tenant.businessLegalName) {
    checks.push(ok('dlc_business_name', 'Business legal name', tenant.businessLegalName))
  } else {
    checks.push(blocker(
      'dlc_business_name',
      'Business legal name',
      'Required for TCR brand registration. Must match EIN registration exactly.',
      'Set businessLegalName on the tenant record.',
    ))
  }

  // EIN
  if (tenant.ein) {
    checks.push(ok('dlc_ein', 'EIN / Tax ID', 'EIN is set (value not displayed for security)'))
  } else {
    checks.push(blocker(
      'dlc_ein',
      'EIN / Tax ID',
      'Required for TCR brand registration. Must match IRS records.',
      'Set ein on the tenant record. This value is stored for submission only and not logged.',
    ))
  }

  // Business address
  if (tenant.businessAddress) {
    checks.push(ok('dlc_business_address', 'Business address', tenant.businessAddress))
  } else {
    checks.push(blocker(
      'dlc_business_address',
      'Business address',
      'Required for TCR brand registration.',
      'Set businessAddress on the tenant record.',
    ))
  }

  // Business website
  if (tenant.businessWebsite) {
    checks.push(ok('dlc_business_website', 'Business website', tenant.businessWebsite))
  } else {
    checks.push(warn(
      'dlc_business_website',
      'Business website',
      'Business website not set. TCR requires a valid domain with terms of service and privacy policy.',
      'Set businessWebsite and ensure the page is publicly accessible.',
    ))
  }

  // Privacy policy URL
  if (tenant.privacyPolicyUrl) {
    checks.push(ok('dlc_privacy_policy', 'Privacy policy URL', tenant.privacyPolicyUrl))
  } else {
    checks.push(blocker(
      'dlc_privacy_policy',
      'Privacy policy URL',
      'Privacy policy is required for 10DLC campaign submission and must be publicly accessible.',
      'Publish a privacy policy and set privacyPolicyUrl on the tenant record.',
    ))
  }

  // Terms URL
  if (tenant.termsUrl) {
    checks.push(ok('dlc_terms', 'Terms of service URL', tenant.termsUrl))
  } else {
    checks.push(blocker(
      'dlc_terms',
      'Terms of service URL',
      'Terms of service URL is required for 10DLC campaign submission.',
      'Publish terms of service and set termsUrl on the tenant record.',
    ))
  }

  // SMS-specific terms
  if (tenant.smsTermsUrl) {
    checks.push(ok('dlc_sms_terms', 'SMS terms URL', tenant.smsTermsUrl))
  } else {
    checks.push(warn(
      'dlc_sms_terms',
      'SMS terms URL',
      'SMS-specific terms not set. Can share the same URL as general terms if SMS consent language is included.',
      'Set smsTermsUrl (can be same as termsUrl if SMS terms are included).',
    ))
  }

  // Brand use case
  if (tenant.brandUseCase) {
    checks.push(ok('dlc_brand_use_case', 'Brand use case (TCR)', tenant.brandUseCase))
  } else {
    checks.push(warn(
      'dlc_brand_use_case',
      'Brand use case (TCR)',
      'Brand use case not set. Required for TCR submission (e.g. MIXED, MARKETING, 2FA).',
      'Set brandUseCase — for dealerships typically "MIXED" or "MARKETING".',
    ))
  }

  // Campaign use case description
  if (tenant.campaignUseCase) {
    checks.push(ok('dlc_campaign_use_case', 'Campaign use case description', 'Configured'))
  } else {
    checks.push(warn(
      'dlc_campaign_use_case',
      'Campaign use case description',
      'Campaign use case description not set. Required for TCR campaign submission.',
      'Set campaignUseCase with a plain-language description of messaging purpose.',
    ))
  }

  // Sample messages
  const samples = tenant.tenDlcSampleMessages as string[] | null
  if (samples && samples.length >= 2) {
    checks.push(ok(
      'dlc_sample_messages',
      '10DLC sample messages',
      `${samples.length} sample message(s) stored`,
    ))
  } else if (samples && samples.length === 1) {
    checks.push(warn(
      'dlc_sample_messages',
      '10DLC sample messages',
      'Only 1 sample message stored. TCR requires at least 2.',
      'Add additional sample messages from the sample message library.',
    ))
  } else {
    checks.push(blocker(
      'dlc_sample_messages',
      '10DLC sample messages',
      'No sample messages stored. TCR requires at least 2 representative sample messages.',
      'Use the sample message library to select and store representative messages.',
    ))
  }

  // Consent explanation
  if (tenant.consentExplanation) {
    checks.push(ok('dlc_consent_explanation', 'Consent explanation', 'Configured'))
  } else {
    checks.push(warn(
      'dlc_consent_explanation',
      'Consent explanation',
      'Consent explanation not set. Describes how SMS consent is obtained from leads.',
      'Set consentExplanation — e.g. "Customers who submitted a web inquiry form that includes SMS consent language."',
    ))
  }

  return { id: 'ten_dlc', title: '10DLC Submission Readiness', checks }
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Run the full Telnyx configuration audit for a tenant.
 * Pure read — no database writes.
 */
export async function runTelnyxConfigAudit(
  tenantId: string
): Promise<TelnyxConfigAuditResult> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`)

  const sections: AuditSection[] = [
    evalEnvSection(),
    evalTenantTelnyxSection(tenant),
    evalWebhookSection(),
    evalTenDlcSection(tenant),
  ]

  let blockerCount = 0
  let warningCount = 0
  for (const section of sections) {
    for (const check of section.checks) {
      if (check.severity === 'blocker') blockerCount++
      if (check.severity === 'warning') warningCount++
    }
  }

  return {
    tenantId,
    tenantName: tenant.name,
    generatedAt: new Date().toISOString(),
    blocked: blockerCount > 0,
    blockerCount,
    warningCount,
    sections,
  }
}

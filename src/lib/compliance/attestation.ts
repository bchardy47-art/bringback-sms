/**
 * Compliance attestation writer + request-context extractor.
 *
 * Single-table polymorphic audit log (see schema.ts complianceAttestations).
 * Strict-write policy: callers should NOT swallow errors from
 * recordAttestation(). If it throws, the upstream action (lead import /
 * campaign approval) must abort. The audit row is mandatory.
 */

import { db } from '@/lib/db'
import { complianceAttestations } from '@/lib/db/schema'

export type AttestationType =
  | 'lead_upload_certification'
  | 'campaign_launch_approval'

export type AttestationResourceType =
  | 'lead_import'
  | 'pilot_batch'

export type RecordAttestationInput = {
  tenantId:                string
  userId:                  string | null
  type:                    AttestationType
  resourceType:            AttestationResourceType
  resourceId:              string
  textVersion:             string
  attestationText:         string
  fileName?:               string | null
  leadCount?:              number | null
  messageTemplateVersion?: string | null
  ipAddress?:              string | null
  userAgent?:              string | null
  metadata?:               Record<string, unknown> | null
}

/**
 * Persist a compliance attestation row.
 *
 * Strict-write contract: this throws on DB error. Callers must let the
 * error propagate (do NOT wrap in try/catch and swallow) so the upstream
 * action returns a non-2xx response and no compliance-gated work happens
 * without a corresponding audit row.
 *
 * Returns the new row id.
 */
export async function recordAttestation(input: RecordAttestationInput): Promise<string> {
  const [row] = await db
    .insert(complianceAttestations)
    .values({
      tenantId:               input.tenantId,
      userId:                 input.userId,
      type:                   input.type,
      resourceType:           input.resourceType,
      resourceId:             input.resourceId,
      textVersion:            input.textVersion,
      attestationText:        input.attestationText,
      fileName:               input.fileName               ?? null,
      leadCount:              input.leadCount              ?? null,
      messageTemplateVersion: input.messageTemplateVersion ?? null,
      ipAddress:              input.ipAddress              ?? null,
      userAgent:              input.userAgent              ?? null,
      metadata:               input.metadata               ?? null,
    })
    .returning({ id: complianceAttestations.id })
  return row.id
}

/**
 * Extract client IP + user agent from a request's headers.
 *
 * Caddy injects x-forwarded-for in production; first value is the real
 * client IP (subsequent entries are upstream proxies). Falls back to
 * x-real-ip when xff isn't present. Returns nulls when neither header
 * is set (local dev, direct origin hits) — never throws.
 *
 * Accepts the standard Headers object so it works with both
 * NextRequest.headers (API routes) and headers() from next/headers
 * (server actions).
 */
export function extractClientContext(reqHeaders: Headers): {
  ipAddress: string | null
  userAgent: string | null
} {
  const xff    = reqHeaders.get('x-forwarded-for')
  const realIp = reqHeaders.get('x-real-ip')
  const ipAddress =
    (xff && xff.split(',')[0]?.trim()) ||
    realIp ||
    null
  const userAgent = reqHeaders.get('user-agent') ?? null
  return { ipAddress, userAgent }
}

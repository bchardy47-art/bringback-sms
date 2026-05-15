import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { optOuts } from '@/lib/db/schema'

// CTIA/TCPA keyword lists.
//
// STOP / HELP must be matched with a strong bias toward false positives —
// missing a real STOP is a compliance failure, whereas opting someone out who
// shaped a message like "I want to stop talking to you" is acceptable.
//
// Matching rule (STOP): the keyword appears as a standalone token anywhere
// in the message, after lowercasing and splitting on non-alphanumerics.
// Examples that match: "STOP", "stop.", "Please stop", "STOP STOP", "stop opt-out".
// Examples that do not match: "stopwatch", "stops", "stopover".
//
// Matching rule (HELP / UNSTOP / START): leading-token only — natural-language
// uses of "help" inside a conversational reply should not trigger a HELP auto-
// reply, and "yes" must not be interpreted as re-subscribing to a STOPped flow.
const STOP_KEYWORDS   = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'remove'])
const UNSTOP_KEYWORDS = new Set(['start', 'unstop', 'subscribe'])
const HELP_KEYWORDS   = new Set(['help', 'info', 'support'])

function tokens(body: string): string[] {
  // Lowercase, split on non-alphanumerics, drop empties.
  return body.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function leadingToken(body: string): string {
  return tokens(body)[0] ?? ''
}

function hasKeyword(body: string, keywords: Set<string>): boolean {
  for (const t of tokens(body)) {
    if (keywords.has(t)) return true
  }
  return false
}

export function isStopMessage(body: string): boolean {
  return hasKeyword(body, STOP_KEYWORDS)
}

export function isUnstopMessage(body: string): boolean {
  // Stricter than STOP — explicit, leading-only, no "yes" overload.
  return UNSTOP_KEYWORDS.has(leadingToken(body))
}

export function isHelpMessage(body: string): boolean {
  return HELP_KEYWORDS.has(leadingToken(body))
}

export async function isOptedOut(tenantId: string, phone: string): Promise<boolean> {
  const row = await db.query.optOuts.findFirst({
    where: and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, phone)),
  })
  return !!row
}

export async function recordOptOut(
  tenantId: string,
  phone: string,
  source: 'inbound_stop' | 'manual' = 'inbound_stop'
): Promise<void> {
  await db
    .insert(optOuts)
    .values({ tenantId, phone, source })
    .onConflictDoNothing()
}

export async function removeOptOut(tenantId: string, phone: string): Promise<void> {
  await db
    .delete(optOuts)
    .where(and(eq(optOuts.tenantId, tenantId), eq(optOuts.phone, phone)))
}

/** Compose the carrier-required HELP auto-reply for a tenant. */
export function buildHelpReply(tenant: {
  name: string
  businessLegalName?: string | null
  settings?: { dealerPhone?: string } | null
}): string {
  const brand   = tenant.businessLegalName ?? tenant.name
  const support = tenant.settings?.dealerPhone
  const supportTail = support ? ` Contact: ${support}.` : ''
  // Keep under 160 chars to fit a single SMS segment.
  return `${brand}: Reply STOP to opt out. Msg & data rates may apply. Msg frequency varies.${supportTail}`
}

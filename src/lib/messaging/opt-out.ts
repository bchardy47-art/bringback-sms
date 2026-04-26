import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { optOuts } from '@/lib/db/schema'

const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'])
const UNSTOP_KEYWORDS = new Set(['start', 'unstop', 'yes'])

export function isStopMessage(body: string): boolean {
  return STOP_KEYWORDS.has(body.trim().toLowerCase())
}

export function isUnstopMessage(body: string): boolean {
  return UNSTOP_KEYWORDS.has(body.trim().toLowerCase())
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

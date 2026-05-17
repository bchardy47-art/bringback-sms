import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'

// Resolve the Stripe customer id for a given tenant. We store the id on
// dealer_intakes (the row that owns the activation/payment flow) rather
// than on tenants — that's where Checkout writes it. A tenant can in
// principle have multiple intake rows; pick the most recent one that has
// a customer id set.
//
// Long-term, stripe_customer_id should probably move onto tenants so the
// lookup is one hop. For now this is a deliberate, minimal scope.
export async function getStripeCustomerIdForTenant(
  tenantId: string,
): Promise<string | null> {
  const intake = await db.query.dealerIntakes.findFirst({
    where: and(
      eq(dealerIntakes.tenantId, tenantId),
      isNotNull(dealerIntakes.stripeCustomerId),
    ),
    orderBy: [desc(dealerIntakes.activatedAt)],
    columns: { stripeCustomerId: true },
  })
  return intake?.stripeCustomerId ?? null
}

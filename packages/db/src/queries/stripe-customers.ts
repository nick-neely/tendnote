import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { stripeCustomers } from "../schema";

/** The Stripe customer id already recorded for this account, if any. */
export async function getStripeCustomerId(input: { userId: string }): Promise<string | null> {
  const [row] = await getDb()
    .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.userId, input.userId))
    .limit(1);
  return row?.stripeCustomerId ?? null;
}

/**
 * Record the account's one Stripe customer and return the id that is on record.
 * The first write wins, so a concurrent second Subscribe reuses the customer the
 * account already has rather than splitting its billing across two.
 */
export async function recordStripeCustomer(input: {
  userId: string;
  stripeCustomerId: string;
}): Promise<string> {
  await getDb().insert(stripeCustomers).values(input).onConflictDoNothing();
  const recorded = await getStripeCustomerId({ userId: input.userId });
  if (!recorded) throw new Error("Failed to record the Stripe customer.");
  return recorded;
}

/** The account a Stripe customer belongs to, or `null` for a customer Tendnote never created. */
export async function findUserIdByStripeCustomerId(input: {
  stripeCustomerId: string;
}): Promise<string | null> {
  const [row] = await getDb()
    .select({ userId: stripeCustomers.userId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, input.stripeCustomerId))
    .limit(1);
  return row?.userId ?? null;
}

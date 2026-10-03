import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "../client";
import { stripeSubscriptions } from "../schema";

/** What Tendnote has on record for one Stripe subscription. */
export type StripeSubscriptionRecord = { cancelAt: Date | null; endedAt: Date | null };

/** The subscription's projected state, or `null` before its first projection. */
export async function getStripeSubscription(input: {
  stripeSubscriptionId: string;
}): Promise<StripeSubscriptionRecord | null> {
  const [row] = await getDb()
    .select({ cancelAt: stripeSubscriptions.cancelAt, endedAt: stripeSubscriptions.endedAt })
    .from(stripeSubscriptions)
    .where(eq(stripeSubscriptions.stripeSubscriptionId, input.stripeSubscriptionId))
    .limit(1);
  return row ?? null;
}

/**
 * Record a subscription's current state, read from Stripe. The end is terminal,
 * as a cancelled Stripe subscription is: once recorded it is never cleared, so
 * a snapshot that was stale by the time it landed cannot revive the subscription.
 */
export async function recordStripeSubscription(input: {
  userId: string;
  stripeSubscriptionId: string;
  cancelAt: Date | null;
  endedAt: Date | null;
}): Promise<void> {
  await getDb()
    .insert(stripeSubscriptions)
    .values(input)
    .onConflictDoUpdate({
      target: stripeSubscriptions.stripeSubscriptionId,
      set: {
        cancelAt: input.cancelAt,
        endedAt: sql`coalesce(${stripeSubscriptions.endedAt}, excluded.ended_at)`,
        updatedAt: new Date(),
      },
    });
}

/** Whether the account holds a live subscription other than this one. */
export async function hasOtherLiveStripeSubscription(input: {
  userId: string;
  stripeSubscriptionId: string;
}): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: stripeSubscriptions.stripeSubscriptionId })
    .from(stripeSubscriptions)
    .where(
      and(
        eq(stripeSubscriptions.userId, input.userId),
        ne(stripeSubscriptions.stripeSubscriptionId, input.stripeSubscriptionId),
        isNull(stripeSubscriptions.endedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * When the account's live subscription is scheduled to end, or `null` when no
 * cancellation is scheduled. Read locally for the Ending notice; never Stripe.
 */
export async function getScheduledCancellation(input: { userId: string }): Promise<Date | null> {
  const [row] = await getDb()
    .select({ cancelAt: stripeSubscriptions.cancelAt })
    .from(stripeSubscriptions)
    .where(
      and(
        eq(stripeSubscriptions.userId, input.userId),
        isNull(stripeSubscriptions.endedAt),
        isNotNull(stripeSubscriptions.cancelAt),
      ),
    )
    .limit(1);
  return row?.cancelAt ?? null;
}

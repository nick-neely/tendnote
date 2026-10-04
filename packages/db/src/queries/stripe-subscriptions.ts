import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
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
 * Past Due is not: a recovered payment clears it (#610).
 */
export async function recordStripeSubscription(input: {
  userId: string;
  stripeSubscriptionId: string;
  cancelAt: Date | null;
  endedAt: Date | null;
  pastDue: { invoiceId: string; since: Date } | null;
}): Promise<void> {
  const { pastDue, ...subscription } = input;
  const pastDueColumns = pastDue
    ? { pastDueInvoiceId: pastDue.invoiceId, pastDueSince: pastDue.since }
    : { pastDueInvoiceId: null, pastDueSince: null };
  await getDb()
    .insert(stripeSubscriptions)
    .values({ ...subscription, ...pastDueColumns })
    .onConflictDoUpdate({
      target: stripeSubscriptions.stripeSubscriptionId,
      set: {
        cancelAt: input.cancelAt,
        endedAt: sql`coalesce(${stripeSubscriptions.endedAt}, excluded.ended_at)`,
        ...pastDueColumns,
        updatedAt: new Date(),
      },
    });
}

/** What the account's billing notices say, read from its live subscription. */
export type BillingStanding = {
  /** When a scheduled cancellation takes effect: the Ending notice (#609). */
  endsAt: Date | null;
  /** When a renewal payment failed: the Past Due notice (#610). */
  pastDueSince: Date | null;
};

/**
 * The account's live subscription's billing standing, both `null` when it
 * renews normally or there is none. The newest live one is the one paying: an
 * older one still live is a predecessor whose end has not been recorded yet.
 * Read locally for the notices; never Stripe.
 */
export async function getBillingStanding(input: { userId: string }): Promise<BillingStanding> {
  const [row] = await getDb()
    .select({
      endsAt: stripeSubscriptions.cancelAt,
      pastDueSince: stripeSubscriptions.pastDueSince,
    })
    .from(stripeSubscriptions)
    .where(and(eq(stripeSubscriptions.userId, input.userId), isNull(stripeSubscriptions.endedAt)))
    .orderBy(desc(stripeSubscriptions.createdAt))
    .limit(1);
  return row ?? { endsAt: null, pastDueSince: null };
}

/**
 * The account's live subscription and any cancellation already scheduled on
 * it, or `null` when it has none. The newest live one is the one paying, as in
 * {@link getBillingStanding}. Read locally; never Stripe.
 */
export async function getLiveSubscription(input: {
  userId: string;
}): Promise<{ stripeSubscriptionId: string; cancelAt: Date | null } | null> {
  const [row] = await getDb()
    .select({
      stripeSubscriptionId: stripeSubscriptions.stripeSubscriptionId,
      cancelAt: stripeSubscriptions.cancelAt,
    })
    .from(stripeSubscriptions)
    .where(and(eq(stripeSubscriptions.userId, input.userId), isNull(stripeSubscriptions.endedAt)))
    .orderBy(desc(stripeSubscriptions.createdAt))
    .limit(1);
  return row ?? null;
}

/** A live subscription whose dunning window has closed, named by its failed invoice. */
export type ClosedDunningWindow = {
  userId: string;
  stripeSubscriptionId: string;
  invoiceId: string;
};

/**
 * Live subscriptions Past Due since at or before `pastDueAtOrBefore`: the ones
 * whose dunning window has closed and that the reconciliation job must end
 * (#610). Each names the failed invoice its window belongs to.
 */
export async function listClosedDunningWindows(input: {
  pastDueAtOrBefore: Date;
}): Promise<ClosedDunningWindow[]> {
  const rows = await getDb()
    .select({
      userId: stripeSubscriptions.userId,
      stripeSubscriptionId: stripeSubscriptions.stripeSubscriptionId,
      invoiceId: stripeSubscriptions.pastDueInvoiceId,
    })
    .from(stripeSubscriptions)
    .where(
      and(
        isNull(stripeSubscriptions.endedAt),
        lte(stripeSubscriptions.pastDueSince, input.pastDueAtOrBefore),
      ),
    );
  return rows.flatMap((row) => (row.invoiceId ? [{ ...row, invoiceId: row.invoiceId }] : []));
}

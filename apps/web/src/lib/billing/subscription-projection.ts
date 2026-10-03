import type Stripe from "stripe";

/** The parts of a Stripe subscription Tendnote projects, read from Stripe's current copy. */
export type SubscriptionSnapshot = {
  id: string;
  stripeCustomerId: string;
  /** When a scheduled cancellation takes effect, or `null` when none is scheduled. */
  cancelAt: Date | null;
  /** When the subscription ended, or `null` while it lives. */
  endedAt: Date | null;
};

function fromUnix(seconds: number): Date {
  return new Date(seconds * 1000);
}

/**
 * When the subscription is scheduled to end. The portal cancels at period end;
 * `cancel_at` carries that date, and the earliest item's period end stands in
 * for an API version that leaves it empty.
 */
function scheduledEnd(subscription: Stripe.Subscription): Date | null {
  if (subscription.cancel_at) return fromUnix(subscription.cancel_at);
  if (!subscription.cancel_at_period_end) return null;
  const periodEnds = subscription.items.data.map((item) => item.current_period_end);
  return periodEnds.length > 0 ? fromUnix(Math.min(...periodEnds)) : null;
}

export function subscriptionSnapshot(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const customer = subscription.customer;
  return {
    id: subscription.id,
    stripeCustomerId: typeof customer === "string" ? customer : customer.id,
    cancelAt: scheduledEnd(subscription),
    endedAt: subscription.ended_at ? fromUnix(subscription.ended_at) : null,
  };
}

export type SubscriptionProjectionDependencies = {
  getSubscription: (input: {
    stripeSubscriptionId: string;
  }) => Promise<{ cancelAt: Date | null; endedAt: Date | null } | null>;
  /** Record the subscription's state. Its end must be terminal once recorded. */
  recordSubscription: (input: {
    userId: string;
    stripeSubscriptionId: string;
    cancelAt: Date | null;
    endedAt: Date | null;
  }) => Promise<unknown>;
  hasOtherLiveSubscription: (input: {
    userId: string;
    stripeSubscriptionId: string;
  }) => Promise<boolean>;
  /** End Paid Access, making the account Lapsed. Must be idempotent. */
  lapsePaidAccess: (input: { userId: string; lapsedAt: Date }) => Promise<unknown>;
  /** Send the content-free cancellation confirmation, keyed on the cancellation. */
  confirmCancellation: (input: {
    userId: string;
    stripeSubscriptionId: string;
    endsAt: Date;
  }) => Promise<unknown>;
};

/**
 * Project one subscription's current state onto its account (#609). A newly
 * scheduled cancellation is confirmed by email before it is recorded, so a
 * failed send leaves nothing recorded and Stripe's redelivery retries it. An
 * ended subscription makes the account Lapsed, unless the account already pays
 * through another one, such as a resubscription whose predecessor's end arrived
 * late. Every step is idempotent, and the snapshot is always Stripe's current
 * copy, so duplicate and reordered events project the same state.
 */
export async function projectSubscription(
  deps: SubscriptionProjectionDependencies,
  userId: string,
  snapshot: SubscriptionSnapshot,
): Promise<void> {
  const stripeSubscriptionId = snapshot.id;
  const previous = await deps.getSubscription({ stripeSubscriptionId });

  if (
    snapshot.cancelAt &&
    !snapshot.endedAt &&
    previous?.cancelAt?.getTime() !== snapshot.cancelAt.getTime()
  ) {
    await deps.confirmCancellation({ userId, stripeSubscriptionId, endsAt: snapshot.cancelAt });
  }

  await deps.recordSubscription({
    userId,
    stripeSubscriptionId,
    cancelAt: snapshot.cancelAt,
    endedAt: snapshot.endedAt,
  });

  if (
    snapshot.endedAt &&
    !(await deps.hasOtherLiveSubscription({ userId, stripeSubscriptionId }))
  ) {
    await deps.lapsePaidAccess({ userId, lapsedAt: snapshot.endedAt });
  }
}

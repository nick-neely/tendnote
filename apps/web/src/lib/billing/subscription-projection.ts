import type { AccessProfile } from "@tendnote/domain";
import type Stripe from "stripe";

/** The parts of a Stripe subscription Tendnote projects, read from Stripe's current copy. */
export type SubscriptionSnapshot = {
  id: string;
  stripeCustomerId: string;
  /** When a scheduled cancellation takes effect, or `null` when none is scheduled. */
  cancelAt: Date | null;
  /** When the subscription ended, or `null` while it lives. */
  endedAt: Date | null;
  /** The renewal whose payment failed, while it stays unpaid (#610); `null` otherwise. */
  pastDue: PastDue | null;
};

/** A failed renewal: the invoice Stripe is retrying, and when its payment first failed. */
export type PastDue = { invoiceId: string; since: Date };

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

/** Stripe's statuses for a subscription whose renewal is still unpaid. */
const PAST_DUE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set(["past_due", "unpaid"]);

/**
 * The failed renewal of a Past Due subscription, read from its latest invoice,
 * which is the one Stripe's status reflects and is retrying. Its first payment
 * attempt is when it was finalized, and that is when the dunning window opens.
 * A later invoice that also fails is a new failure with its own window, as a
 * dunning extension naming the earlier invoice does not cover it (#633).
 */
function pastDueRenewal(subscription: Stripe.Subscription): PastDue | null {
  if (!PAST_DUE_STATUSES.has(subscription.status)) return null;
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === "string") {
    throw new Error("A Past Due subscription must be read with its latest invoice expanded.");
  }
  if (!invoice.id) throw new Error("A Past Due subscription's latest invoice has no id.");
  return {
    invoiceId: invoice.id,
    since: fromUnix(invoice.status_transitions.finalized_at ?? invoice.created),
  };
}

export function subscriptionSnapshot(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const customer = subscription.customer;
  return {
    id: subscription.id,
    stripeCustomerId: typeof customer === "string" ? customer : customer.id,
    cancelAt: scheduledEnd(subscription),
    endedAt: subscription.ended_at ? fromUnix(subscription.ended_at) : null,
    pastDue: pastDueRenewal(subscription),
  };
}

/**
 * Whether this subscription is the one granting the account's Paid Access. A
 * paid grant recorded before subscriptions were tracked names none, and is
 * taken to be paid for by whichever subscription asks.
 */
export function paysForAccount(
  profile: Pick<AccessProfile, "status" | "source" | "paidAccessSubscriptionId"> | null,
  stripeSubscriptionId: string,
): boolean {
  return (
    profile?.status === "granted" &&
    profile.source === "paid_access" &&
    (profile.paidAccessSubscriptionId ?? stripeSubscriptionId) === stripeSubscriptionId
  );
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
    pastDue: PastDue | null;
  }) => Promise<unknown>;
  /**
   * End the Paid Access this subscription granted, making the account Lapsed.
   * Must be atomic and idempotent, and change nothing when another subscription
   * now pays for the account.
   */
  lapsePaidAccess: (input: {
    userId: string;
    stripeSubscriptionId: string;
    lapsedAt: Date;
  }) => Promise<unknown>;
  /**
   * Whether this subscription is the one granting the account's Paid Access.
   * Only that one's cancellation is confirmed: a disputed subscription whose
   * renewal Tendnote stopped (#617) is not the customer cancelling anything.
   */
  paysForAccount: (input: { userId: string; stripeSubscriptionId: string }) => Promise<boolean>;
  /** Send the content-free cancellation confirmation, keyed on the cancellation. */
  confirmCancellation: (input: {
    userId: string;
    stripeSubscriptionId: string;
    endsAt: Date;
  }) => Promise<unknown>;
};

/**
 * Project one subscription's current state onto its account (#609). A newly
 * scheduled cancellation of the subscription paying for the account is
 * confirmed by email before it is recorded, so a failed send leaves nothing
 * recorded and Stripe's redelivery retries it. An
 * ended subscription makes the account Lapsed if it is the one paying for the
 * account, so a resubscription whose predecessor's end arrives late is left
 * alone. A failed renewal is recorded as Past Due for its notice and cleared
 * once the payment recovers (#610); the account stays admitted throughout, and
 * only the reconciliation job closing the dunning window ends it. Every step
 * is idempotent, and the snapshot is always Stripe's current copy, so
 * duplicate and reordered events project the same state.
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
    previous?.cancelAt?.getTime() !== snapshot.cancelAt.getTime() &&
    (await deps.paysForAccount({ userId, stripeSubscriptionId }))
  ) {
    await deps.confirmCancellation({ userId, stripeSubscriptionId, endsAt: snapshot.cancelAt });
  }

  await deps.recordSubscription({
    userId,
    stripeSubscriptionId,
    cancelAt: snapshot.cancelAt,
    endedAt: snapshot.endedAt,
    pastDue: snapshot.pastDue,
  });

  if (snapshot.endedAt) {
    await deps.lapsePaidAccess({ userId, stripeSubscriptionId, lapsedAt: snapshot.endedAt });
  }
}

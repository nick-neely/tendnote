import { vi } from "vitest";
import type { PaidAccessAdmissionDependencies } from "./paid-access-admission";
import type { PastDue, SubscriptionSnapshot } from "./subscription-projection";

type AccessProfileWrites = {
  lapsePaidAccess: PaidAccessAdmissionDependencies["subscriptions"]["lapsePaidAccess"];
};

/**
 * Stripe's current copy of each subscription beside Tendnote's projection of
 * them, for the webhook and reconciliation proofs. The projection's end is
 * terminal like the Drizzle store's, and lapsing writes into the caller's
 * Access Profile queries, so admission is answered the way production wires it.
 */
export function createStripeSubscriptionsFake(
  profiles: AccessProfileWrites,
  input: { stripeCustomerId: string; now?: () => Date },
) {
  const now = input.now ?? (() => new Date());
  const live = (id: string): SubscriptionSnapshot => ({
    id,
    stripeCustomerId: input.stripeCustomerId,
    cancelAt: null,
    endedAt: null,
    pastDue: null,
  });
  const stripe = new Map<string, SubscriptionSnapshot>([["sub_1", live("sub_1")]]);
  const recorded = new Map<
    string,
    { userId: string; cancelAt: Date | null; endedAt: Date | null; pastDue: PastDue | null }
  >();
  const confirmCancellation = vi.fn(
    async (_input: { userId: string; stripeSubscriptionId: string; endsAt: Date }) => {},
  );

  const subscriptions: PaidAccessAdmissionDependencies["subscriptions"] = {
    getSubscription: async ({ stripeSubscriptionId }) => recorded.get(stripeSubscriptionId) ?? null,
    recordSubscription: async ({ stripeSubscriptionId, userId, cancelAt, endedAt, pastDue }) => {
      const previous = recorded.get(stripeSubscriptionId);
      recorded.set(stripeSubscriptionId, {
        userId,
        cancelAt,
        endedAt: previous?.endedAt ?? endedAt,
        pastDue,
      });
    },
    lapsePaidAccess: (lapse) => profiles.lapsePaidAccess(lapse),
    confirmCancellation,
  };

  const retrieveSubscription = vi.fn(async (id: string) => {
    const subscription = stripe.get(id);
    if (!subscription) throw new Error(`No such subscription: ${id}`);
    return subscription;
  });

  /** Stripe's immediate cancellation: the subscription ends now and its retries stop. */
  const cancelSubscription = vi.fn(async (id: string) => {
    const subscription = await retrieveSubscription(id);
    if (subscription.endedAt) throw new Error(`Subscription ${id} is already canceled`);
    const ended = { ...subscription, endedAt: now(), pastDue: null };
    stripe.set(id, ended);
    return ended;
  });

  /** The Drizzle query's filter over the recorded projection. */
  const listClosedDunningWindows = async ({ pastDueAtOrBefore }: { pastDueAtOrBefore: Date }) =>
    [...recorded].flatMap(([stripeSubscriptionId, record]) =>
      !record.endedAt && record.pastDue && record.pastDue.since <= pastDueAtOrBefore
        ? [{ userId: record.userId, stripeSubscriptionId, invoiceId: record.pastDue.invoiceId }]
        : [],
    );

  /** Change Stripe's copy of a subscription, as the portal, a period end, or a failed renewal does. */
  function stripeChanges(id: string, change: Partial<SubscriptionSnapshot>) {
    stripe.set(id, { ...(stripe.get(id) ?? live(id)), ...change });
  }

  return {
    subscriptions,
    retrieveSubscription,
    cancelSubscription,
    listClosedDunningWindows,
    recorded,
    confirmCancellation,
    stripeChanges,
  };
}

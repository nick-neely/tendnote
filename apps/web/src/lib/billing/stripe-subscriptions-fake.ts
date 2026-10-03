import { vi } from "vitest";
import type { PaidAccessAdmissionDependencies } from "./paid-access-admission";
import type { SubscriptionSnapshot } from "./subscription-projection";

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
  input: { stripeCustomerId: string },
) {
  const stripe = new Map<string, SubscriptionSnapshot>([
    [
      "sub_1",
      { id: "sub_1", stripeCustomerId: input.stripeCustomerId, cancelAt: null, endedAt: null },
    ],
  ]);
  const recorded = new Map<
    string,
    { userId: string; cancelAt: Date | null; endedAt: Date | null }
  >();
  const confirmCancellation = vi.fn(
    async (_input: { userId: string; stripeSubscriptionId: string; endsAt: Date }) => {},
  );

  const subscriptions: PaidAccessAdmissionDependencies["subscriptions"] = {
    getSubscription: async ({ stripeSubscriptionId }) => recorded.get(stripeSubscriptionId) ?? null,
    recordSubscription: async ({ stripeSubscriptionId, userId, cancelAt, endedAt }) => {
      const previous = recorded.get(stripeSubscriptionId);
      recorded.set(stripeSubscriptionId, {
        userId,
        cancelAt,
        endedAt: previous?.endedAt ?? endedAt,
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

  /** Change Stripe's copy of a subscription, as the portal or a period end does. */
  function stripeChanges(id: string, change: Partial<SubscriptionSnapshot>) {
    const current = stripe.get(id) ?? {
      id,
      stripeCustomerId: input.stripeCustomerId,
      cancelAt: null,
      endedAt: null,
    };
    stripe.set(id, { ...current, ...change });
  }

  return { subscriptions, retrieveSubscription, recorded, confirmCancellation, stripeChanges };
}

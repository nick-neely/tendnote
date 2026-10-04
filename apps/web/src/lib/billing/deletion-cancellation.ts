import type Stripe from "stripe";

/** The slice of the Stripe client the cancellation uses. */
export type DeletionCancellationStripeClient = {
  subscriptions: {
    list: (
      params: Stripe.SubscriptionListParams,
    ) => Promise<{ data: ReadonlyArray<{ id: string; status: Stripe.Subscription.Status }> }>;
    cancel: (id: string, params: Stripe.SubscriptionCancelParams) => Promise<unknown>;
  };
};

export type DeletionCancellationDependencies = {
  /** Read lazily, so an account that never billed needs no Stripe configuration. */
  stripe: () => DeletionCancellationStripeClient;
  getStripeCustomerId: (input: { userId: string }) => Promise<string | null>;
};

/** Statuses Stripe can never charge from again. */
const ENDED_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "canceled",
  "incomplete_expired",
]);

/**
 * Cancel every subscription the deleted account could still be charged for,
 * now and with no refund of the remainder (#619): no proration credit and no
 * final invoice. An abandoned `incomplete` one is cancelled too, so it can
 * never be paid after the account is gone. Ended ones are skipped, which makes
 * a retry after a partial failure safe.
 */
export async function cancelSubscriptionsForDeletion(
  deps: DeletionCancellationDependencies,
  input: { userId: string },
): Promise<void> {
  const customer = await deps.getStripeCustomerId(input);
  if (!customer) return;

  const stripe = deps.stripe();
  const { data } = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
  for (const subscription of data) {
    if (ENDED_STATUSES.has(subscription.status)) continue;
    await stripe.subscriptions.cancel(subscription.id, { prorate: false, invoice_now: false });
  }
}

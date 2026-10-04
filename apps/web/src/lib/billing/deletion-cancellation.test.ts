import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { cancelSubscriptionsForDeletion } from "./deletion-cancellation";

function harness(subscriptions: Array<{ id: string; status: Stripe.Subscription.Status }>) {
  const stripe = {
    subscriptions: {
      list: vi.fn(async (_params: Stripe.SubscriptionListParams) => ({ data: subscriptions })),
      cancel: vi.fn(async (_id: string, _params: Stripe.SubscriptionCancelParams) => ({})),
    },
  };
  return {
    stripe,
    deps: {
      stripe: vi.fn(() => stripe),
      getStripeCustomerId: vi.fn(async () => "cus_1" as string | null),
    },
  };
}

describe("cancelSubscriptionsForDeletion", () => {
  it("cancels every live subscription now, with no proration or final invoice", async () => {
    const { stripe, deps } = harness([
      { id: "sub_active", status: "active" },
      { id: "sub_past_due", status: "past_due" },
      { id: "sub_abandoned", status: "incomplete" },
    ]);

    await cancelSubscriptionsForDeletion(deps, { userId: "user_1" });

    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_1",
      status: "all",
      limit: 100,
    });
    expect(stripe.subscriptions.cancel.mock.calls).toEqual([
      ["sub_active", { prorate: false, invoice_now: false }],
      ["sub_past_due", { prorate: false, invoice_now: false }],
      ["sub_abandoned", { prorate: false, invoice_now: false }],
    ]);
  });

  it("skips subscriptions that have already ended, so a retry is safe", async () => {
    const { stripe, deps } = harness([
      { id: "sub_cancelled", status: "canceled" },
      { id: "sub_expired", status: "incomplete_expired" },
    ]);

    await cancelSubscriptionsForDeletion(deps, { userId: "user_1" });

    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("never reaches Stripe for an account that never billed", async () => {
    const { deps } = harness([]);
    deps.getStripeCustomerId.mockResolvedValueOnce(null);

    await cancelSubscriptionsForDeletion(deps, { userId: "user_1" });

    expect(deps.stripe).not.toHaveBeenCalled();
  });
});

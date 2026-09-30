import { describe, expect, it, vi } from "vitest";
import {
  type CheckoutDependencies,
  openCheckout,
  parseBillingInterval,
  readStripeBillingConfig,
} from "./checkout";

const account = { userId: "subscriber-1", email: "subscriber@example.com" };

function fakeStripeBilling() {
  const customers = new Map<string, string>();
  let created = 0;
  const createCustomer = vi.fn(async () => ({ id: `cus_${++created}` }));
  const createSession = vi.fn(async () => ({ url: "https://checkout.stripe.test/c/pay_1" }));
  const deps: CheckoutDependencies = {
    stripe: {
      customers: { create: createCustomer },
      checkout: { sessions: { create: createSession } },
    },
    prices: { monthly: "price_monthly", annual: "price_annual" },
    baseUrl: "https://app.tendnote.test",
    getStripeCustomerId: async ({ userId }) => customers.get(userId) ?? null,
    recordStripeCustomer: async ({ userId, stripeCustomerId }) => {
      if (!customers.has(userId)) customers.set(userId, stripeCustomerId);
      return customers.get(userId) as string;
    },
  };
  return { deps, customers, createCustomer, createSession };
}

describe("opening Stripe Checkout", () => {
  it("asks for a card-only US-taxed subscription to the chosen price, referencing the account", async () => {
    const billing = fakeStripeBilling();

    const url = await openCheckout(billing.deps, { ...account, interval: "annual" });

    expect(url).toBe("https://checkout.stripe.test/c/pay_1");
    expect(billing.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_1",
        client_reference_id: account.userId,
        line_items: [{ price: "price_annual", quantity: 1 }],
        payment_method_types: ["card"],
        billing_address_collection: "required",
        automatic_tax: { enabled: true },
        success_url: "https://app.tendnote.test/confirming",
        cancel_url: "https://app.tendnote.test/pending",
      }),
    );
  });

  it("records the account's Stripe customer before Checkout opens and reuses it on every later attempt", async () => {
    const billing = fakeStripeBilling();
    billing.createSession.mockImplementationOnce(async () => {
      expect(billing.customers.get(account.userId)).toBe("cus_1");
      return { url: "https://checkout.stripe.test/c/pay_1" };
    });

    await openCheckout(billing.deps, { ...account, interval: "monthly" });
    await openCheckout(billing.deps, { ...account, interval: "annual" });

    expect(billing.createCustomer).toHaveBeenCalledTimes(1);
    expect(billing.createCustomer).toHaveBeenCalledWith(
      { email: account.email, metadata: { tendnote_user_id: account.userId } },
      { idempotencyKey: `tendnote-customer-${account.userId}` },
    );
    expect(billing.createSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        line_items: [{ price: "price_annual", quantity: 1 }],
      }),
    );
  });

  it("fails rather than redirecting nowhere when Stripe returns no URL", async () => {
    const billing = fakeStripeBilling();
    billing.createSession.mockResolvedValueOnce({ url: null } as never);

    await expect(openCheckout(billing.deps, { ...account, interval: "monthly" })).rejects.toThrow(
      /did not return a URL/,
    );
  });
});

describe("Stripe billing configuration", () => {
  it("is present only when the key and both prices are set", () => {
    const complete = {
      STRIPE_SECRET_KEY: "sk_test_1",
      STRIPE_PRICE_MONTHLY: "price_monthly",
      STRIPE_PRICE_ANNUAL: "price_annual",
    };

    expect(readStripeBillingConfig(complete)).toEqual({
      secretKey: "sk_test_1",
      prices: { monthly: "price_monthly", annual: "price_annual" },
    });
    expect(readStripeBillingConfig({ ...complete, STRIPE_PRICE_ANNUAL: undefined })).toBeNull();
    expect(readStripeBillingConfig({})).toBeNull();
  });

  it("accepts only the plan's two intervals", () => {
    expect(parseBillingInterval("monthly")).toBe("monthly");
    expect(parseBillingInterval("annual")).toBe("annual");
    expect(parseBillingInterval("weekly")).toBeNull();
    expect(parseBillingInterval(null)).toBeNull();
  });
});

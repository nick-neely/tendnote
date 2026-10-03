import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { invoiceSubscription } from "./first-paid-invoice";

const invoice = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "in_1",
    object: "invoice",
    customer: { id: "cus_1" },
    parent: { subscription_details: { subscription: "sub_1" } },
    ...overrides,
  }) as unknown as Stripe.Invoice;

describe("the subscription an invoice bills (#617)", () => {
  it("reads the subscription and customer, expanded or not", () => {
    expect(invoiceSubscription(invoice())).toEqual({
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
    });
  });

  it("is null outside a subscription, and for a reference it cannot read", () => {
    expect(invoiceSubscription(invoice({ parent: null }))).toBeNull();
    expect(invoiceSubscription("in_1")).toBeNull();
    expect(invoiceSubscription({ id: "in_1", deleted: true } as Stripe.DeletedInvoice)).toBeNull();
    expect(invoiceSubscription(undefined)).toBeNull();
  });
});

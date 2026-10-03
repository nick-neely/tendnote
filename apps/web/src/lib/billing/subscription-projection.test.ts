import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { subscriptionSnapshot } from "./subscription-projection";

const PERIOD_END = 1776272645; // 2026-04-15T17:04:05Z

function subscription(fields: Partial<Stripe.Subscription>): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    latest_invoice: "in_renewal",
    cancel_at: null,
    cancel_at_period_end: false,
    ended_at: null,
    items: { data: [{ current_period_end: PERIOD_END }] },
    ...fields,
  } as unknown as Stripe.Subscription;
}

describe("reading a Stripe subscription", () => {
  it("reads a live subscription with nothing scheduled", () => {
    expect(subscriptionSnapshot(subscription({}))).toEqual({
      id: "sub_1",
      stripeCustomerId: "cus_1",
      cancelAt: null,
      endedAt: null,
      pastDue: null,
    });
  });

  it("reads a scheduled cancellation from cancel_at", () => {
    const snapshot = subscriptionSnapshot(
      subscription({ cancel_at: PERIOD_END, cancel_at_period_end: true }),
    );

    expect(snapshot.cancelAt?.toISOString()).toBe("2026-04-15T17:04:05.000Z");
  });

  it("falls back to the period end when only cancel_at_period_end is set", () => {
    const snapshot = subscriptionSnapshot(subscription({ cancel_at_period_end: true }));

    expect(snapshot.cancelAt?.toISOString()).toBe("2026-04-15T17:04:05.000Z");
  });

  it("reads when an ended subscription ended, and an expanded customer", () => {
    const snapshot = subscriptionSnapshot(
      subscription({ ended_at: PERIOD_END, customer: { id: "cus_1" } as Stripe.Customer }),
    );

    expect(snapshot).toMatchObject({ stripeCustomerId: "cus_1" });
    expect(snapshot.endedAt?.toISOString()).toBe("2026-04-15T17:04:05.000Z");
  });

  it("reads a failed renewal from the latest invoice, from its first payment attempt", () => {
    const FAILED = 1776276245; // 2026-04-15T18:04:05Z, an hour after the period renewed
    for (const status of ["past_due", "unpaid"] as const) {
      const snapshot = subscriptionSnapshot(
        subscription({
          status,
          latest_invoice: {
            id: "in_renewal",
            created: PERIOD_END,
            status_transitions: { finalized_at: FAILED },
          } as Stripe.Invoice,
        }),
      );

      expect(snapshot.pastDue).toEqual({
        invoiceId: "in_renewal",
        since: new Date("2026-04-15T18:04:05.000Z"),
      });
    }
  });

  it("refuses to guess when a Past Due subscription was read without its invoice", () => {
    expect(() => subscriptionSnapshot(subscription({ status: "past_due" }))).toThrow(
      /latest invoice expanded/,
    );
  });

  it("is not Past Due once the payment recovers, or once the subscription ends", () => {
    for (const status of ["active", "canceled"] as const) {
      expect(subscriptionSnapshot(subscription({ status })).pastDue).toBeNull();
    }
  });
});

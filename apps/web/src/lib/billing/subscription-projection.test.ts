import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { subscriptionSnapshot } from "./subscription-projection";

const PERIOD_END = 1776272645; // 2026-04-15T17:04:05Z

function subscription(fields: Partial<Stripe.Subscription>): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
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
});

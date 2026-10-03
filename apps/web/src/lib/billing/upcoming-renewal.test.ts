import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { annualRenewal } from "./upcoming-renewal";

const unix = (iso: string) => Date.parse(iso) / 1000;

function line(start: string, end: string, type = "subscription_item_details") {
  return { parent: { type }, period: { start: unix(start), end: unix(end) } };
}

/** Stripe's preview of a renewal invoice, which has no id until it is created. */
function upcoming(lines: object[], fields: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    object: "invoice",
    customer: "cus_1",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_1", metadata: {} },
    },
    lines: { data: lines },
    ...fields,
  } as unknown as Stripe.Invoice;
}

describe("reading an upcoming invoice for an annual renewal (#611)", () => {
  it("reads a renewal that pays for a year, due when that year starts", () => {
    expect(annualRenewal(upcoming([line("2027-03-15T17:04:05Z", "2028-03-15T17:04:05Z")]))).toEqual(
      {
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        renewsAt: new Date("2027-03-15T17:04:05Z"),
      },
    );
  });

  it("reads a year that spans a leap day", () => {
    expect(
      annualRenewal(upcoming([line("2027-06-01T00:00:00Z", "2028-06-01T00:00:00Z")]))?.renewsAt,
    ).toEqual(new Date("2027-06-01T00:00:00Z"));
  });

  it("reads nothing from a monthly renewal, including the first month after switching from annual", () => {
    expect(
      annualRenewal(upcoming([line("2027-03-15T17:04:05Z", "2027-04-15T17:04:05Z")])),
    ).toBeNull();
  });

  it("reads nothing from a year-long line that is not a subscription item", () => {
    expect(
      annualRenewal(
        upcoming([line("2027-03-15T17:04:05Z", "2028-03-15T17:04:05Z", "invoice_item_details")]),
      ),
    ).toBeNull();
  });

  it("reads nothing from an upcoming invoice outside a subscription", () => {
    expect(
      annualRenewal(
        upcoming([line("2027-03-15T17:04:05Z", "2028-03-15T17:04:05Z")], { parent: null }),
      ),
    ).toBeNull();
  });
});

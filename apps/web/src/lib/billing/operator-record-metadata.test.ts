import type { SuspensionCredit } from "@tendnote/db/queries/suspension-credits";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  operatorRecordStripeReads,
  refundRecordFromStripe,
  refundRecordMetadata,
  suspensionCreditFromStripe,
  suspensionCreditMetadata,
} from "./operator-record-metadata";

const REFUND_RECORD_ID = "5c1b7f0e-0000-4000-8000-000000000001";
const CREDIT_ID = "5c1b7f0e-0000-4000-8000-000000000002";

function stripeRefund(overrides: Partial<Stripe.Refund> = {}): Stripe.Refund {
  return {
    id: "re_1",
    payment_intent: "pi_1",
    amount: 2000,
    created: 1_790_000_000,
    status: "succeeded",
    metadata: refundRecordMetadata({
      id: REFUND_RECORD_ID,
      invoiceId: "in_1",
      stripeSubscriptionId: "sub_1",
    }),
    ...overrides,
  } as Stripe.Refund;
}

const credit: SuspensionCredit = {
  id: CREDIT_ID,
  userId: "u1",
  suspensionId: "5c1b7f0e-0000-4000-8000-000000000003",
  terminationId: null,
  stripeSubscriptionId: "sub_1",
  invoiceId: "in_1",
  invoiceLineItemId: "il_1",
  paymentIntentId: "pi_1",
  suspendedAmount: 300,
  remainderAmount: 0,
  amount: 330,
  instrument: "balance",
  requestedAt: new Date("2026-10-01T12:00:00.000Z"),
  stripeCreditNoteId: null,
  stripeRefundId: null,
};

function creditNote(overrides: Partial<Stripe.CreditNote> = {}): Stripe.CreditNote {
  return {
    id: "cn_1",
    invoice: "in_1",
    total: 330,
    refunds: [],
    metadata: suspensionCreditMetadata(credit),
    ...overrides,
  } as unknown as Stripe.CreditNote;
}

describe("a Refund record carried on its Stripe refund (#723)", () => {
  it("rebuilds the record's Stripe side from the refund made for it", () => {
    expect(refundRecordFromStripe(stripeRefund(), REFUND_RECORD_ID)).toEqual({
      id: REFUND_RECORD_ID,
      stripeSubscriptionId: "sub_1",
      invoiceId: "in_1",
      paymentIntentId: "pi_1",
      amount: 2000,
      stripeRefundId: "re_1",
    });
  });

  it("is nothing for a refund made for another record, or for none", () => {
    expect(refundRecordFromStripe(stripeRefund(), "another")).toBeNull();
    expect(refundRecordFromStripe(stripeRefund({ metadata: {} }), REFUND_RECORD_ID)).toBeNull();
  });

  it("is nothing when the refund names no payment", () => {
    expect(
      refundRecordFromStripe(stripeRefund({ payment_intent: null }), REFUND_RECORD_ID),
    ).toBeNull();
  });

  it("leaves a refund that moved no money off the record, as the action does", () => {
    expect(
      refundRecordFromStripe(stripeRefund({ status: "failed" }), REFUND_RECORD_ID),
    ).toMatchObject({ stripeRefundId: null });
  });
});

describe("a Suspension Credit carried on its credit note (#723)", () => {
  it("rebuilds every field the record stores but its account and time", () => {
    const { userId, requestedAt, ...stripeSide } = credit;

    expect(suspensionCreditFromStripe(creditNote(), CREDIT_ID)).toEqual({
      ...stripeSide,
      stripeCreditNoteId: "cn_1",
      stripeRefundId: null,
    });
  });

  it("keeps a termination's credit and the card refund it made", () => {
    const terminated = { ...credit, terminationId: "t-1", remainderAmount: 750 };
    const note = creditNote({
      metadata: suspensionCreditMetadata({ ...terminated, instrument: "card" }),
      refunds: [{ refund: "re_cn_1" }] as Stripe.CreditNote["refunds"],
    });

    expect(suspensionCreditFromStripe(note, CREDIT_ID)).toMatchObject({
      terminationId: "t-1",
      remainderAmount: 750,
      instrument: "card",
      stripeRefundId: "re_cn_1",
    });
  });

  it("stores no metadata value for an absent id, and reads it back as absent", () => {
    const bare = { ...credit, suspensionId: null, paymentIntentId: null };
    const metadata = suspensionCreditMetadata(bare);

    expect(Object.values(metadata)).not.toContain("");
    expect(suspensionCreditFromStripe(creditNote({ metadata }), CREDIT_ID)).toMatchObject({
      suspensionId: null,
      paymentIntentId: null,
    });
  });

  it("is nothing for a note made for another record, or one made before it carried the record", () => {
    expect(suspensionCreditFromStripe(creditNote(), "another")).toBeNull();
    expect(
      suspensionCreditFromStripe(
        creditNote({ metadata: { suspension_credit: CREDIT_ID } }),
        CREDIT_ID,
      ),
    ).toBeNull();
  });
});

describe("finding a lost record in Stripe (#723)", () => {
  function stripeWith(refunds: unknown[], notes: unknown[]) {
    const stripe = {
      refunds: {
        list: vi.fn(async function* () {
          yield* refunds;
        }),
      },
      creditNotes: {
        list: vi.fn(async function* () {
          yield* notes;
        }),
      },
    };
    const reads = operatorRecordStripeReads(
      () => stripe as unknown as Stripe,
      async ({ userId }) => (userId === "u1" ? "cus_1" : null),
    );
    return { stripe, reads };
  }

  it("finds the refund carrying the record among those created since its time, and only reads", async () => {
    const { stripe, reads } = stripeWith(
      [stripeRefund({ id: "re_other", metadata: {} }), stripeRefund()],
      [],
    );
    const since = new Date("2026-10-01T11:00:00.000Z");

    await expect(
      reads.findStripeRefund({ refundRecordId: REFUND_RECORD_ID, createdSince: since }),
    ).resolves.toMatchObject({ id: REFUND_RECORD_ID, stripeRefundId: "re_1" });
    expect(stripe.refunds.list).toHaveBeenCalledWith({
      created: { gte: since.getTime() / 1000 },
      limit: 100,
    });
    await expect(
      reads.findStripeRefund({ refundRecordId: "another", createdSince: since }),
    ).resolves.toBeNull();
  });

  it("finds the credit note carrying the record on the account's customer", async () => {
    const { stripe, reads } = stripeWith(
      [],
      [creditNote({ id: "cn_other", metadata: {} }), creditNote()],
    );

    await expect(
      reads.findStripeSuspensionCredit({ userId: "u1", suspensionCreditId: CREDIT_ID }),
    ).resolves.toMatchObject({ id: CREDIT_ID, stripeCreditNoteId: "cn_1" });
    expect(stripe.creditNotes.list).toHaveBeenCalledWith({ customer: "cus_1", limit: 100 });
  });

  it("finds no credit note for an account with no Stripe customer", async () => {
    const { stripe, reads } = stripeWith([], [creditNote()]);

    await expect(
      reads.findStripeSuspensionCredit({ userId: "u2", suspensionCreditId: CREDIT_ID }),
    ).resolves.toBeNull();
    expect(stripe.creditNotes.list).not.toHaveBeenCalled();
  });
});

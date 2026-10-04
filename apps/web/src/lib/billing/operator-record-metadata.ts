import type { RefundRecord } from "@tendnote/db/queries/paid-access-revocations";
import type { SuspensionCredit } from "@tendnote/db/queries/suspension-credits";
import type Stripe from "stripe";
import { stripeId } from "./first-paid-invoice";

/**
 * What a Stripe refund or credit note carries about the Operator Action record
 * it was made for (#723). A restore whose data lost the record rebuilds it from
 * these under the record's own id, which the Recovery Journal names, so nothing
 * asks Stripe to move the money again. Stripe metadata holds strings only, and
 * an absent id is left out rather than stored empty.
 */

/** The Stripe side of a Refund record: everything but its account and times. */
export type StripeRefundRecord = Omit<RefundRecord, "userId" | "requestedAt" | "revokedAt">;

/** The Stripe side of a Suspension Credit: everything but its account and time. */
export type StripeSuspensionCredit = Omit<SuspensionCredit, "userId" | "requestedAt">;

const UNREFUNDED = new Set(["failed", "canceled"]);
const WHOLE_NUMBER = /^\d+$/;

export function refundRecordMetadata(
  record: Pick<RefundRecord, "id" | "invoiceId" | "stripeSubscriptionId">,
): Record<string, string> {
  return {
    refund_record: record.id,
    invoice: record.invoiceId,
    subscription: record.stripeSubscriptionId,
  };
}

/**
 * The record a Stripe refund was made for, if it is `refundRecordId`. A refund
 * that moved no money stays off the record, as the Refund action leaves it.
 */
export function refundRecordFromStripe(
  refund: Stripe.Refund,
  refundRecordId: string,
): StripeRefundRecord | null {
  const metadata = refund.metadata ?? {};
  const paymentIntentId = stripeId(refund.payment_intent);
  if (metadata.refund_record !== refundRecordId) return null;
  if (!metadata.invoice || !metadata.subscription || !paymentIntentId) return null;
  return {
    id: refundRecordId,
    stripeSubscriptionId: metadata.subscription,
    invoiceId: metadata.invoice,
    paymentIntentId,
    amount: refund.amount,
    stripeRefundId: refund.status && UNREFUNDED.has(refund.status) ? null : refund.id,
  };
}

export function suspensionCreditMetadata(record: SuspensionCredit): Record<string, string> {
  const optional = {
    suspension: record.suspensionId,
    termination: record.terminationId,
    payment_intent: record.paymentIntentId,
  };
  return {
    suspension_credit: record.id,
    subscription: record.stripeSubscriptionId,
    invoice_line_item: record.invoiceLineItemId,
    suspended_amount: String(record.suspendedAmount),
    remainder_amount: String(record.remainderAmount),
    instrument: record.instrument,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== null)),
  };
}

/**
 * The Suspension Credit a credit note was made for, if it is
 * `suspensionCreditId` and the note carries the whole record. A note made
 * before credit notes carried it yields nothing.
 */
export function suspensionCreditFromStripe(
  note: Stripe.CreditNote,
  suspensionCreditId: string,
): StripeSuspensionCredit | null {
  const metadata = note.metadata ?? {};
  if (metadata.suspension_credit !== suspensionCreditId) return null;
  const invoiceId = stripeId(note.invoice);
  const { subscription, invoice_line_item, suspended_amount, remainder_amount, instrument } =
    metadata;
  if (!invoiceId || !subscription || !invoice_line_item) return null;
  if (!WHOLE_NUMBER.test(suspended_amount ?? "") || !WHOLE_NUMBER.test(remainder_amount ?? "")) {
    return null;
  }
  if (instrument !== "balance" && instrument !== "card") return null;
  return {
    id: suspensionCreditId,
    suspensionId: metadata.suspension ?? null,
    terminationId: metadata.termination ?? null,
    stripeSubscriptionId: subscription,
    invoiceId,
    invoiceLineItemId: invoice_line_item,
    paymentIntentId: metadata.payment_intent ?? null,
    suspendedAmount: Number(suspended_amount),
    remainderAmount: Number(remainder_amount),
    amount: note.total,
    instrument,
    stripeCreditNoteId: note.id,
    stripeRefundId: stripeId(note.refunds[0]?.refund ?? null),
  };
}

/**
 * The Stripe reads a restore re-records a lost refund or Suspension Credit
 * from: the refund or credit note that carries the record. Nothing is written.
 */
export function operatorRecordStripeReads(
  stripe: () => Pick<Stripe, "refunds" | "creditNotes">,
  findStripeCustomer: (input: { userId: string }) => Promise<string | null>,
) {
  return {
    findStripeRefund: async (input: {
      refundRecordId: string;
      createdSince: Date;
    }): Promise<StripeRefundRecord | null> => {
      for await (const refund of stripe().refunds.list({
        created: { gte: Math.floor(input.createdSince.getTime() / 1000) },
        limit: 100,
      })) {
        const record = refundRecordFromStripe(refund, input.refundRecordId);
        if (record) return record;
      }
      return null;
    },
    findStripeSuspensionCredit: async (input: {
      userId: string;
      suspensionCreditId: string;
    }): Promise<StripeSuspensionCredit | null> => {
      const customer = await findStripeCustomer({ userId: input.userId });
      if (!customer) return null;
      for await (const note of stripe().creditNotes.list({ customer, limit: 100 })) {
        const record = suspensionCreditFromStripe(note, input.suspensionCreditId);
        if (record) return record;
      }
      return null;
    },
  };
}

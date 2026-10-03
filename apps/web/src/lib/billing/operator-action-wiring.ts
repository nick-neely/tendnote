import "server-only";

import { blobRecoveryJournal } from "@tendnote/db/queries/account-deletion";
import {
  grantAdmissionException,
  recordRefund,
} from "@tendnote/db/queries/paid-access-revocations";
import { stripeId } from "./first-paid-invoice";
import type { OperatorActionDependencies, RefundableInvoice } from "./operator-actions";
import { configuredStripe, paidAccessProjection } from "./paid-access-projection";
import { refundSnapshot } from "./paid-access-revocation";
import { subscriptionSnapshot } from "./subscription-projection";

/** A paid subscription invoice and the payment that paid it. */
async function retrieveRefundableInvoice(invoiceId: string): Promise<RefundableInvoice> {
  const invoice = await configuredStripe().invoices.retrieve(invoiceId, { expand: ["payments"] });
  if (invoice.status !== "paid") throw new Error(`Invoice ${invoiceId} is ${invoice.status}.`);
  const stripeSubscriptionId = stripeId(invoice.parent?.subscription_details?.subscription ?? null);
  const stripeCustomerId = stripeId(invoice.customer);
  const payment = invoice.payments?.data.find((each) => each.status === "paid");
  const paymentIntentId = stripeId(payment?.payment.payment_intent ?? null);
  if (!stripeSubscriptionId || !stripeCustomerId || !paymentIntentId) {
    throw new Error(`Invoice ${invoiceId} is not a card-paid subscription invoice.`);
  }
  return {
    invoiceId,
    stripeCustomerId,
    stripeSubscriptionId,
    paymentIntentId,
    amountPaid: invoice.amount_paid,
  };
}

/**
 * The production dependencies of the Operator Actions (#617): the same
 * projection the webhook and reconciliation write through, plus the records,
 * the Recovery Journal, and the Stripe calls only an operator makes.
 */
export const operatorActionDependencies: OperatorActionDependencies = {
  ...paidAccessProjection,
  journal: blobRecoveryJournal,
  records: { recordRefund, grantAdmissionException },
  retrieveRefundableInvoice,
  createRefund: async ({ paymentIntentId, amount, idempotencyKey }) =>
    refundSnapshot(
      await configuredStripe().refunds.create(
        { payment_intent: paymentIntentId, amount, reason: "requested_by_customer" },
        { idempotencyKey },
      ),
    ),
  retrieveDisputeStatus: async (stripeDisputeId) =>
    (await configuredStripe().disputes.retrieve(stripeDisputeId)).status,
  resumeRenewal: async (stripeSubscriptionId) =>
    subscriptionSnapshot(
      await configuredStripe().subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: false,
        expand: ["latest_invoice"],
      }),
    ),
};

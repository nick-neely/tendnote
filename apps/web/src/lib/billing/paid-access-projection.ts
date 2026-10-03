import "server-only";

import {
  getAccessProfile,
  grantAccess,
  lapsePaidAccess,
} from "@tendnote/db/queries/access-profiles";
import { getAuthUserEmail } from "@tendnote/db/queries/auth-users";
import {
  attachStripeRefund,
  findUnmatchedRefundRecord,
  getDispute,
  getRefundRecordByStripeRefund,
  listSubscriptionRevocationBlocks,
  markDisputeRenewalStopped,
  markRefundRevoked,
  recordDispute,
} from "@tendnote/db/queries/paid-access-revocations";
import { findUserIdByStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import {
  getStripeSubscription,
  listClosedDunningWindows,
  recordStripeSubscription,
} from "@tendnote/db/queries/stripe-subscriptions";
import { anchorUsagePeriod } from "@tendnote/db/queries/usage-bounds";
import Stripe from "stripe";
import { sendAdmittedEmail } from "./admitted-email";
import { sendCancellationEmail } from "./cancellation-email";
import { readStripeBillingConfig } from "./checkout";
import { invoiceSubscription } from "./first-paid-invoice";
import { sendRefundEmail } from "./refund-email";
import { sendRenewalReminderEmail } from "./renewal-reminder-email";
import { paysForAccount, subscriptionSnapshot } from "./subscription-projection";

export function configuredStripe(): Stripe {
  const config = readStripeBillingConfig();
  // Unconfigured, the work fails and is retried once Stripe is configured.
  if (!config) throw new Error("Stripe is not configured.");
  return new Stripe(config.secretKey);
}

/**
 * The production writes behind the Paid Access projection, shared by the
 * webhook receiver and the reconciliation job so the two cannot drift apart.
 */
export const paidAccessProjection = {
  findAccountByStripeCustomer: (stripeCustomerId: string) =>
    findUserIdByStripeCustomerId({ stripeCustomerId }),
  readAccessProfile: (userId: string) => getAccessProfile({ userId }),
  grantPaidAccess: (userId: string, stripeSubscriptionId: string) =>
    grantAccess({ userId, source: "paid_access", stripeSubscriptionId }),
  anchorUsagePeriod: (userId: string, startedAt: Date) => anchorUsagePeriod({ userId, startedAt }),
  announceAdmission: async ({ userId, invoiceId }: { userId: string; invoiceId: string }) => {
    // An account deleted since it paid has nobody left to tell.
    const to = await getAuthUserEmail({ userId });
    if (to) await sendAdmittedEmail({ to, invoiceId });
  },
  remindOfRenewal: async (input: {
    userId: string;
    stripeSubscriptionId: string;
    renewsAt: Date;
  }) => {
    // An account deleted since it subscribed has nobody left to remind.
    const to = await getAuthUserEmail({ userId: input.userId });
    if (to) {
      await sendRenewalReminderEmail({
        to,
        stripeSubscriptionId: input.stripeSubscriptionId,
        renewsAt: input.renewsAt,
      });
    }
  },
  retrieveSubscription: async (stripeSubscriptionId: string) =>
    subscriptionSnapshot(
      // The latest invoice is the renewal a Past Due subscription is retrying (#610).
      await configuredStripe().subscriptions.retrieve(stripeSubscriptionId, {
        expand: ["latest_invoice"],
      }),
    ),
  listClosedDunningWindows,
  cancelSubscription: async (stripeSubscriptionId: string) =>
    subscriptionSnapshot(await configuredStripe().subscriptions.cancel(stripeSubscriptionId)),
  stopRenewal: async (stripeSubscriptionId: string) =>
    subscriptionSnapshot(
      // Expanded like a read: a Past Due subscription stays Past Due (#610).
      await configuredStripe().subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true,
        expand: ["latest_invoice"],
      }),
    ),
  /** The subscription a payment paid for, through the invoice it paid (#617). */
  resolvePaymentSubscription: async (paymentIntentId: string) => {
    const payments = await configuredStripe().invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: paymentIntentId },
      expand: ["data.invoice"],
      limit: 1,
    });
    return invoiceSubscription(payments.data[0]?.invoice);
  },
  confirmRefund: async (input: { userId: string; refundRecordId: string }) => {
    const to = await getAuthUserEmail({ userId: input.userId });
    if (to) await sendRefundEmail({ to, refundRecordId: input.refundRecordId });
  },
  revocations: {
    getRefundRecordByStripeRefund,
    findUnmatchedRefundRecord,
    attachStripeRefund,
    markRefundRevoked,
    getDispute,
    recordDispute,
    markDisputeRenewalStopped,
    listSubscriptionRevocationBlocks,
  },
  subscriptions: {
    getSubscription: getStripeSubscription,
    recordSubscription: recordStripeSubscription,
    lapsePaidAccess,
    paysForAccount: async (input: { userId: string; stripeSubscriptionId: string }) =>
      paysForAccount(await getAccessProfile({ userId: input.userId }), input.stripeSubscriptionId),
    confirmCancellation: async (input: {
      userId: string;
      stripeSubscriptionId: string;
      endsAt: Date;
    }) => {
      const to = await getAuthUserEmail({ userId: input.userId });
      if (to) {
        await sendCancellationEmail({
          to,
          stripeSubscriptionId: input.stripeSubscriptionId,
          endsAt: input.endsAt,
        });
      }
    },
  },
};

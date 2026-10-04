import "server-only";

import { blobRecoveryJournal } from "@tendnote/db/queries/account-deletion";
import {
  findRefundRecordForInvoice,
  grantAdmissionException,
  recordRefund,
} from "@tendnote/db/queries/paid-access-revocations";
import { getLiveSubscription } from "@tendnote/db/queries/stripe-subscriptions";
import {
  findLatestSuspension,
  findOpenSuspension,
  liftSuspension,
  recordSuspension,
  renewSuspensionDeadline,
} from "@tendnote/db/queries/temporary-suspensions";
import {
  attachTerminationSubscription,
  findTermination,
  recordTermination,
} from "@tendnote/db/queries/terminations";
import { type OperatorActionDependencies, refundableInvoice } from "./operator-actions";
import { configuredStripe, paidAccessProjection } from "./paid-access-projection";
import { refundSnapshot } from "./paid-access-revocation";
import { subscriptionSnapshot } from "./subscription-projection";

/**
 * The production dependencies of the Operator Actions (#617): the same
 * projection the webhook and reconciliation write through, plus the records,
 * the Recovery Journal, and the Stripe calls only an operator makes. The
 * Temporary Suspension actions (#629) use only the records, the journal, and
 * session revocation; Termination (#630) adds stopping the renewal.
 */
export const operatorActionDependencies: OperatorActionDependencies = {
  ...paidAccessProjection,
  journal: blobRecoveryJournal,
  records: { findRefundRecordForInvoice, recordRefund, grantAdmissionException },
  suspensions: {
    findOpenSuspension,
    findLatestSuspension,
    recordSuspension,
    renewSuspensionDeadline,
    liftSuspension,
  },
  terminations: { findTermination, recordTermination, attachTerminationSubscription },
  findLiveSubscription: getLiveSubscription,
  // Loaded on use, as the recovery cron does, so the refund actions never boot auth.
  revokeSessions: async (input) => (await import("@/lib/auth/server")).revokeUserSessions(input),
  retrieveRefundableInvoice: async (invoiceId) =>
    refundableInvoice(
      await configuredStripe().invoices.retrieve(invoiceId, { expand: ["payments"] }),
    ),
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

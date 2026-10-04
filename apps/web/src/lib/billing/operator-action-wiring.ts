import "server-only";

import {
  readCeilingOverrides,
  recordCeilingOverride,
} from "@tendnote/db/queries/account-ceiling-overrides";
import { blobRecoveryJournal } from "@tendnote/db/queries/account-deletion";
import { grantDunningExtension } from "@tendnote/db/queries/dunning-extensions";
import { recordLegalHold } from "@tendnote/db/queries/legal-holds";
import {
  findRefundRecordForInvoice,
  grantAdmissionException,
  recordRefund,
} from "@tendnote/db/queries/paid-access-revocations";
import { getStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import {
  findPastDueSubscription,
  getLiveSubscription,
} from "@tendnote/db/queries/stripe-subscriptions";
import {
  attachSuspensionCreditNote,
  attachSuspensionCreditRefund,
  listSuspensionCreditsForExit,
  recordSuspensionCredit,
} from "@tendnote/db/queries/suspension-credits";
import {
  findLatestSuspension,
  findOpenSuspension,
  getSuspension,
  liftSuspension,
  recordSuspension,
  renewSuspensionDeadline,
} from "@tendnote/db/queries/temporary-suspensions";
import {
  attachTerminationSubscription,
  findTermination,
  recordTermination,
} from "@tendnote/db/queries/terminations";
import { readUsagePeriod } from "@tendnote/db/queries/usage-bounds";
import { type OperatorActionDependencies, refundableInvoice } from "./operator-actions";
import { configuredStripe, paidAccessProjection } from "./paid-access-projection";
import { refundSnapshot } from "./paid-access-revocation";
import { subscriptionSnapshot } from "./subscription-projection";
import { suspensionCreditStripeCalls } from "./suspension-credit";

/**
 * The production dependencies of the Operator Actions (#617): the same
 * projection the webhook and reconciliation write through, plus the records,
 * the Recovery Journal, and the Stripe calls only an operator makes. The
 * Temporary Suspension actions (#629) use only the records, the journal, and
 * session revocation; Termination (#630) adds stopping the renewal. The
 * Suspension Credit (#631) issued at a lift or a termination adds its records
 * and the credit note calls. The dunning extension and the Account Ceiling
 * override (#633), and the Legal Hold (#632), use only their records and the
 * journal.
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
  getSuspension,
  dunning: { findPastDueSubscription, grantDunningExtension },
  ceilings: { readUsagePeriod, readCeilingOverrides, recordCeilingOverride },
  legalHolds: { recordLegalHold },
  credits: {
    listSuspensionCreditsForExit,
    recordSuspensionCredit,
    attachSuspensionCreditNote,
    attachSuspensionCreditRefund,
  },
  findStripeCustomer: getStripeCustomerId,
  ...suspensionCreditStripeCalls(configuredStripe),
  findLiveSubscription: getLiveSubscription,
  // Loaded on use, as the recovery cron does, so the refund actions never boot auth.
  revokeSessions: async (input) => (await import("@/lib/auth/server")).revokeUserSessions(input),
  retrieveRefundableInvoice: async (invoiceId) =>
    refundableInvoice(
      await configuredStripe().invoices.retrieve(invoiceId, { expand: ["payments"] }),
    ),
  createRefund: async ({ paymentIntentId, amount, idempotencyKey, metadata }) =>
    refundSnapshot(
      await configuredStripe().refunds.create(
        { payment_intent: paymentIntentId, amount, reason: "requested_by_customer", metadata },
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

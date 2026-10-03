import type { AccessProfile, RecoveryJournal } from "@tendnote/domain";
import {
  applyStripeRefund,
  isSubscriptionRevoked,
  type PaidAccessRevocationDependencies,
  type RefundSnapshot,
} from "./paid-access-revocation";
import { projectSubscription, type SubscriptionSnapshot } from "./subscription-projection";

/** A paid invoice a Refund can return money from, read from Stripe. */
export type RefundableInvoice = {
  invoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  paymentIntentId: string;
  amountPaid: number;
};

export type OperatorActionDependencies = PaidAccessRevocationDependencies & {
  journal: RecoveryJournal;
  /** The Operator Action records (ADR 0248), written before any Stripe call. */
  records: {
    recordRefund: (input: {
      userId: string;
      stripeSubscriptionId: string;
      invoiceId: string;
      paymentIntentId: string;
      amount: number;
      requestedAt: Date;
    }) => Promise<{ id: string; requestedAt: Date }>;
    grantAdmissionException: (input: {
      userId: string;
      blockKind: "dispute";
      event: string;
      grantedAt: Date;
    }) => Promise<{ id: string; grantedAt: Date }>;
  };
  retrieveRefundableInvoice: (invoiceId: string) => Promise<RefundableInvoice>;
  /** Create the Stripe refund under the record's idempotency key. */
  createRefund: (input: {
    paymentIntentId: string;
    amount: number;
    idempotencyKey: string;
  }) => Promise<RefundSnapshot>;
  retrieveDisputeStatus: (stripeDisputeId: string) => Promise<string>;
  /** Undo a stopped renewal: the subscription renews at its period end again. */
  resumeRenewal: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  readAccessProfile: (userId: string) => Promise<Pick<AccessProfile, "status"> | null>;
  grantPaidAccess: (userId: string, stripeSubscriptionId: string) => Promise<unknown>;
};

/**
 * The Refund Operator Action (ADR 0249). The Refund record is written and
 * journaled before Stripe is asked for anything that moves money, and the
 * refund is created under the record's id as its idempotency key, so a refund
 * that succeeds while the response is lost is still explained: reconciliation
 * matches it to the record on payment, amount, and time. The returned refund is
 * then applied at once, which revokes Paid Access on the refunded subscription
 * and sends the confirmation.
 *
 * Defaults to the full amount paid, as the fourteen-day guarantee refunds.
 */
export async function refundInvoice(
  deps: OperatorActionDependencies,
  input: { invoiceId: string; amount?: number; now?: Date },
) {
  const invoice = await deps.retrieveRefundableInvoice(input.invoiceId);
  const amount = input.amount ?? invoice.amountPaid;
  if (!Number.isInteger(amount) || amount <= 0 || amount > invoice.amountPaid) {
    throw new Error(
      `A refund must be a whole amount between 1 and the ${invoice.amountPaid} paid on ${invoice.invoiceId}.`,
    );
  }
  const userId = await deps.findAccountByStripeCustomer(invoice.stripeCustomerId);
  if (!userId) throw new Error(`Invoice ${invoice.invoiceId} belongs to no Tendnote account.`);

  const record = await deps.records.recordRefund({
    userId,
    stripeSubscriptionId: invoice.stripeSubscriptionId,
    invoiceId: invoice.invoiceId,
    paymentIntentId: invoice.paymentIntentId,
    amount,
    requestedAt: input.now ?? new Date(),
  });
  await deps.journal.write({
    kind: "refund",
    accountId: userId,
    actionId: record.id,
    at: record.requestedAt,
  });

  const refund = await deps.createRefund({
    paymentIntentId: invoice.paymentIntentId,
    amount,
    idempotencyKey: `refund:${record.id}`,
  });
  await deps.revocations.attachStripeRefund({ id: record.id, stripeRefundId: refund.id });
  const outcome = await applyStripeRefund(deps, refund, input.now);
  return { refundRecordId: record.id, stripeRefundId: refund.id, outcome };
}

type ReadmissionResult =
  | { restored: true; grantId: string }
  | { restored: false; grantId: string; reason: "subscription_ended" | "still_revoked" };

/**
 * Re-admit after a won dispute (ADR 0248). The re-admission grant names the
 * dispute, so it excepts that dispute alone and is void against any later one.
 * It is written and journaled before Stripe is asked to resume the renewal the
 * dispute stopped, then Paid Access is restored on the same subscription. A
 * subscription that has since ended, or carries another standing revocation,
 * is recorded as excepted and restores nothing: the customer resubscribes.
 *
 * Safe to run again: the grant naming a dispute is written once.
 */
export async function readmitAfterWonDispute(
  deps: OperatorActionDependencies,
  input: { stripeDisputeId: string; now?: Date },
): Promise<ReadmissionResult> {
  const dispute = await deps.revocations.getDispute({ stripeDisputeId: input.stripeDisputeId });
  if (!dispute) {
    throw new Error(
      `No dispute ${input.stripeDisputeId} is on record; let the webhook or reconciliation record it first.`,
    );
  }
  const status = await deps.retrieveDisputeStatus(dispute.stripeDisputeId);
  if (status !== "won") {
    throw new Error(`Dispute ${dispute.stripeDisputeId} is ${status}, not won.`);
  }

  const { userId, stripeSubscriptionId } = dispute;
  const grant = await deps.records.grantAdmissionException({
    userId,
    blockKind: "dispute",
    event: dispute.stripeDisputeId,
    grantedAt: input.now ?? new Date(),
  });
  await deps.journal.write({
    kind: "grant",
    accountId: userId,
    actionId: grant.id,
    at: grant.grantedAt,
  });

  if (await isSubscriptionRevoked(deps.revocations, stripeSubscriptionId)) {
    return { restored: false, grantId: grant.id, reason: "still_revoked" };
  }
  let subscription = await deps.retrieveSubscription(stripeSubscriptionId);
  if (subscription.endedAt) {
    await projectSubscription(deps.subscriptions, userId, subscription);
    return { restored: false, grantId: grant.id, reason: "subscription_ended" };
  }
  if (dispute.renewalStopped && subscription.cancelAt) {
    subscription = await deps.resumeRenewal(stripeSubscriptionId);
  }
  // An account another subscription admitted since keeps that one.
  if ((await deps.readAccessProfile(userId))?.status !== "granted") {
    await deps.grantPaidAccess(userId, stripeSubscriptionId);
  }
  await projectSubscription(deps.subscriptions, userId, subscription);
  return { restored: true, grantId: grant.id };
}

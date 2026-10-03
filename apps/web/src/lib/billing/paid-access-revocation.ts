import type { DisputeRecord, RefundRecord } from "@tendnote/db/queries/paid-access-revocations";
import { type AdmissionBlock, decideAdmission } from "@tendnote/domain";
import type Stripe from "stripe";
import { stripeId } from "./first-paid-invoice";
import {
  projectSubscription,
  type SubscriptionProjectionDependencies,
  type SubscriptionSnapshot,
} from "./subscription-projection";

/** The parts of a Stripe refund revocation reads. */
export type RefundSnapshot = {
  id: string;
  paymentIntentId: string | null;
  amount: number;
  createdAt: Date;
  status: string | null;
};

/** The parts of a Stripe dispute revocation reads. */
export type DisputeSnapshot = { id: string; paymentIntentId: string | null; openedAt: Date };

export function refundSnapshot(refund: Stripe.Refund): RefundSnapshot {
  return {
    id: refund.id,
    paymentIntentId: stripeId(refund.payment_intent),
    amount: refund.amount,
    createdAt: new Date(refund.created * 1000),
    status: refund.status,
  };
}

export function disputeSnapshot(dispute: Stripe.Dispute): DisputeSnapshot {
  return {
    id: dispute.id,
    paymentIntentId: stripeId(dispute.payment_intent),
    openedAt: new Date(dispute.created * 1000),
  };
}

/**
 * How long after its Refund record a refund whose id was never stored may still
 * be matched to it on payment and amount (ADR 0249). The record is written
 * moments before the refund is created, so a day only absorbs a runbook
 * interrupted between the two.
 */
const REFUND_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How far a refund's `created` may fall before its record's `requestedAt`.
 * Stripe states whole seconds, so a refund made in the same second as its
 * record reads as up to a second earlier, and the two clocks are not one.
 */
const REFUND_CLOCK_SKEW_MS = 60 * 1000;

/** Refund statuses under which no money went back, so nothing is revoked. */
const UNREFUNDED_STATUSES = new Set(["failed", "canceled"]);

/** Tendnote's records behind refund and dispute revocation (#617). */
export type RevocationRecords = {
  getRefundRecordByStripeRefund: (input: {
    stripeRefundId: string;
  }) => Promise<RefundRecord | null>;
  findUnmatchedRefundRecord: (input: {
    paymentIntentId: string;
    amount: number;
    requestedAtOrAfter: Date;
    requestedAtOrBefore: Date;
  }) => Promise<RefundRecord | null>;
  attachStripeRefund: (input: { id: string; stripeRefundId: string }) => Promise<void>;
  markRefundRevoked: (input: { id: string; at: Date }) => Promise<void>;
  getDispute: (input: { stripeDisputeId: string }) => Promise<DisputeRecord | null>;
  recordDispute: (input: {
    stripeDisputeId: string;
    userId: string;
    stripeSubscriptionId: string;
    openedAt: Date;
  }) => Promise<DisputeRecord>;
  markDisputeRenewalStopped: (input: { stripeDisputeId: string }) => Promise<void>;
  listSubscriptionRevocationBlocks: (input: {
    stripeSubscriptionId: string;
  }) => Promise<readonly AdmissionBlock[]>;
};

export type PaidAccessRevocationDependencies = {
  revocations: RevocationRecords;
  subscriptions: SubscriptionProjectionDependencies;
  retrieveSubscription: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  /** End a subscription in Stripe at once, returning Stripe's copy of the ended subscription. */
  cancelSubscription: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  /** Stop a subscription renewing: Stripe cancels it at its period end. */
  stopRenewal: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  findAccountByStripeCustomer: (stripeCustomerId: string) => Promise<string | null>;
  /** The subscription and customer a payment paid for, read from Stripe; `null` outside one. */
  resolvePaymentSubscription: (
    paymentIntentId: string,
  ) => Promise<{ stripeSubscriptionId: string; stripeCustomerId: string } | null>;
  /** The content-free refund confirmation, keyed on the Refund record. */
  confirmRefund: (input: { userId: string; refundRecordId: string }) => Promise<unknown>;
};

/**
 * Whether a subscription's Paid Access is revoked: a refund made under a
 * Refund record naming it, or a dispute on it that no re-admission grant names
 * (ADR 0248). The first-paid-invoice rule asks this before admitting, so
 * reconciliation re-projecting a first invoice that is still paid in Stripe
 * never re-admits a refunded or disputed account (#608, #617).
 */
export async function isSubscriptionRevoked(
  revocations: Pick<RevocationRecords, "listSubscriptionRevocationBlocks">,
  stripeSubscriptionId: string,
): Promise<boolean> {
  const blocks = await revocations.listSubscriptionRevocationBlocks({ stripeSubscriptionId });
  return !decideAdmission({ sourceAdmits: true, blocks });
}

type RefundOutcome = "revoked" | "already_revoked" | "unmatched" | "not_refunded";

/** The Refund record a Stripe refund belongs to, by its id or else by payment, amount, and time. */
async function matchRefundRecord(
  records: RevocationRecords,
  refund: RefundSnapshot,
): Promise<RefundRecord | null> {
  const byId = await records.getRefundRecordByStripeRefund({ stripeRefundId: refund.id });
  if (byId || !refund.paymentIntentId) return byId;

  const record = await records.findUnmatchedRefundRecord({
    paymentIntentId: refund.paymentIntentId,
    amount: refund.amount,
    requestedAtOrAfter: new Date(refund.createdAt.getTime() - REFUND_MATCH_WINDOW_MS),
    requestedAtOrBefore: new Date(refund.createdAt.getTime() + REFUND_CLOCK_SKEW_MS),
  });
  if (!record) return null;
  // The id write the Refund Operator Action lost, repaired here.
  await records.attachStripeRefund({ id: record.id, stripeRefundId: refund.id });
  return { ...record, stripeRefundId: refund.id };
}

/**
 * Apply one Stripe refund to Paid Access (ADR 0249). Revocation follows the
 * refund's origin, never its amount: a refund matching a Refund record revokes
 * Paid Access on the subscription that record names and nothing else, so a
 * fresh subscription is unaffected by an older refund. A refund matching no
 * record changes nothing and is returned as `unmatched` for the caller to
 * raise the reconciliation alert.
 *
 * Revoking makes the account Lapsed through the same end every other lapse
 * uses, and ends the subscription in Stripe so the refunded customer is never
 * charged again. Then the confirmation is sent and the record marked, so a
 * redelivery or a later reconciliation pass changes and sends nothing. Every
 * step is idempotent, so a failure part-way is finished by the next delivery
 * or pass.
 */
export async function applyStripeRefund(
  deps: PaidAccessRevocationDependencies,
  refund: RefundSnapshot,
  now: Date = new Date(),
): Promise<RefundOutcome> {
  if (refund.status && UNREFUNDED_STATUSES.has(refund.status)) return "not_refunded";

  const record = await matchRefundRecord(deps.revocations, refund);
  if (!record) return "unmatched";
  if (record.revokedAt) return "already_revoked";

  const { userId, stripeSubscriptionId } = record;
  await deps.subscriptions.lapsePaidAccess({
    userId,
    stripeSubscriptionId,
    lapsedAt: refund.createdAt,
  });
  const current = await deps.retrieveSubscription(stripeSubscriptionId);
  const subscription = current.endedAt
    ? current
    : await deps.cancelSubscription(stripeSubscriptionId);
  await projectSubscription(deps.subscriptions, userId, subscription);

  await deps.confirmRefund({ userId, refundRecordId: record.id });
  await deps.revocations.markRefundRevoked({ id: record.id, at: now });
  return "revoked";
}

type DisputeOutcome =
  | "revoked"
  | "already_revoked"
  | "excepted"
  | "outside_subscription"
  | "unknown_customer";

/** The dispute on record, recording it first from Stripe if this is its first sight. */
async function recordedDispute(
  deps: PaidAccessRevocationDependencies,
  dispute: DisputeSnapshot,
): Promise<
  { record: DisputeRecord; isNew: boolean } | "outside_subscription" | "unknown_customer"
> {
  const recorded = await deps.revocations.getDispute({ stripeDisputeId: dispute.id });
  if (recorded) return { record: recorded, isNew: false };

  const payment = dispute.paymentIntentId
    ? await deps.resolvePaymentSubscription(dispute.paymentIntentId)
    : null;
  if (!payment) return "outside_subscription";
  const userId = await deps.findAccountByStripeCustomer(payment.stripeCustomerId);
  if (!userId) return "unknown_customer";
  const record = await deps.revocations.recordDispute({
    stripeDisputeId: dispute.id,
    userId,
    stripeSubscriptionId: payment.stripeSubscriptionId,
    openedAt: dispute.openedAt,
  });
  return { record, isNew: true };
}

/**
 * Apply one Stripe dispute to Paid Access (ADR 0245, ADR 0248). The dispute is
 * recorded as a block on the disputed subscription and revokes at once: the
 * account becomes Lapsed from the moment the dispute opened. Unless a
 * re-admission grant names this dispute, which leaves it alone.
 *
 * The subscription is not ended but stopped from renewing, so a Lapsed account
 * is never charged again while a won dispute can still be undone on the same
 * subscription. The stop is noted on the dispute before it is asked of Stripe,
 * so re-admission resumes only a renewal Tendnote stopped, never one the
 * customer cancelled. Idempotent, like a refund: a dispute already on record
 * is applied again, to finish any step a failure interrupted, and reported as
 * `already_revoked`.
 */
export async function applyStripeDispute(
  deps: PaidAccessRevocationDependencies,
  dispute: DisputeSnapshot,
): Promise<DisputeOutcome> {
  const seen = await recordedDispute(deps, dispute);
  if (typeof seen === "string") return seen;

  const { record: recorded, isNew } = seen;
  const { userId, stripeSubscriptionId } = recorded;
  const blocks = await deps.revocations.listSubscriptionRevocationBlocks({ stripeSubscriptionId });
  const block = blocks.find((each) => each.kind === "dispute" && each.event === dispute.id);
  if (block && decideAdmission({ sourceAdmits: true, blocks: [block] })) return "excepted";

  await deps.subscriptions.lapsePaidAccess({
    userId,
    stripeSubscriptionId,
    lapsedAt: recorded.openedAt,
  });

  let subscription = await deps.retrieveSubscription(stripeSubscriptionId);
  if (!subscription.endedAt && !subscription.cancelAt) {
    await deps.revocations.markDisputeRenewalStopped({ stripeDisputeId: dispute.id });
    subscription = await deps.stopRenewal(stripeSubscriptionId);
  }
  await projectSubscription(deps.subscriptions, userId, subscription);
  return isNew ? "revoked" : "already_revoked";
}

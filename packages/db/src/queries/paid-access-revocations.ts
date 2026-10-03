import type { AdmissionBlock } from "@tendnote/domain";
import { and, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { getDb } from "../client";
import { admissionExceptions, refundRecords, stripeDisputes } from "../schema";

/** A Refund Operator Action's record (ADR 0249). */
export type RefundRecord = {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
  invoiceId: string;
  paymentIntentId: string;
  amount: number;
  requestedAt: Date;
  stripeRefundId: string | null;
  revokedAt: Date | null;
};

const refundColumns = {
  id: refundRecords.id,
  userId: refundRecords.userId,
  stripeSubscriptionId: refundRecords.stripeSubscriptionId,
  invoiceId: refundRecords.invoiceId,
  paymentIntentId: refundRecords.paymentIntentId,
  amount: refundRecords.amount,
  requestedAt: refundRecords.requestedAt,
  stripeRefundId: refundRecords.stripeRefundId,
  revokedAt: refundRecords.revokedAt,
};

/** Write a Refund record. It must commit before the Stripe refund is created. */
export async function recordRefund(input: {
  userId: string;
  stripeSubscriptionId: string;
  invoiceId: string;
  paymentIntentId: string;
  amount: number;
  requestedAt: Date;
}): Promise<RefundRecord> {
  const [row] = await getDb().insert(refundRecords).values(input).returning(refundColumns);
  if (!row) throw new Error("Failed to write the Refund record.");
  return row;
}

/** The Refund record a Stripe refund was matched to, by the refund's id. */
export async function getRefundRecordByStripeRefund(input: {
  stripeRefundId: string;
}): Promise<RefundRecord | null> {
  const [row] = await getDb()
    .select(refundColumns)
    .from(refundRecords)
    .where(eq(refundRecords.stripeRefundId, input.stripeRefundId))
    .limit(1);
  return row ?? null;
}

/**
 * The newest Refund record without a Stripe refund id that names this payment
 * and amount and was written inside the window: how a refund whose id write
 * was lost is matched (ADR 0249).
 */
export async function findUnmatchedRefundRecord(input: {
  paymentIntentId: string;
  amount: number;
  requestedAtOrAfter: Date;
  requestedAtOrBefore: Date;
}): Promise<RefundRecord | null> {
  const [row] = await getDb()
    .select(refundColumns)
    .from(refundRecords)
    .where(
      and(
        eq(refundRecords.paymentIntentId, input.paymentIntentId),
        eq(refundRecords.amount, input.amount),
        isNull(refundRecords.stripeRefundId),
        gte(refundRecords.requestedAt, input.requestedAtOrAfter),
        lte(refundRecords.requestedAt, input.requestedAtOrBefore),
      ),
    )
    .orderBy(desc(refundRecords.requestedAt))
    .limit(1);
  return row ?? null;
}

/** Store the Stripe refund id on its record. A record keeps the first id it is given. */
export async function attachStripeRefund(input: {
  id: string;
  stripeRefundId: string;
}): Promise<void> {
  await getDb()
    .update(refundRecords)
    .set({ stripeRefundId: input.stripeRefundId })
    .where(and(eq(refundRecords.id, input.id), isNull(refundRecords.stripeRefundId)));
}

/** Note that the revocation a Refund record asked for was applied and confirmed. */
export async function markRefundRevoked(input: { id: string; at: Date }): Promise<void> {
  await getDb()
    .update(refundRecords)
    .set({ revokedAt: input.at })
    .where(and(eq(refundRecords.id, input.id), isNull(refundRecords.revokedAt)));
}

/** A dispute Stripe reported on a subscription's payment. */
export type DisputeRecord = {
  stripeDisputeId: string;
  userId: string;
  stripeSubscriptionId: string;
  openedAt: Date;
  renewalStopped: boolean;
};

const disputeColumns = {
  stripeDisputeId: stripeDisputes.stripeDisputeId,
  userId: stripeDisputes.userId,
  stripeSubscriptionId: stripeDisputes.stripeSubscriptionId,
  openedAt: stripeDisputes.openedAt,
  renewalStopped: stripeDisputes.renewalStopped,
};

export async function getDispute(input: {
  stripeDisputeId: string;
}): Promise<DisputeRecord | null> {
  const [row] = await getDb()
    .select(disputeColumns)
    .from(stripeDisputes)
    .where(eq(stripeDisputes.stripeDisputeId, input.stripeDisputeId))
    .limit(1);
  return row ?? null;
}

/** Record a dispute, or return the one already on record under its id. */
export async function recordDispute(input: {
  stripeDisputeId: string;
  userId: string;
  stripeSubscriptionId: string;
  openedAt: Date;
}): Promise<DisputeRecord> {
  await getDb().insert(stripeDisputes).values(input).onConflictDoNothing();
  const recorded = await getDispute(input);
  if (!recorded) throw new Error("Failed to record the dispute.");
  return recorded;
}

/** Note that Tendnote scheduled the disputed subscription's cancellation. */
export async function markDisputeRenewalStopped(input: { stripeDisputeId: string }): Promise<void> {
  await getDb()
    .update(stripeDisputes)
    .set({ renewalStopped: true })
    .where(eq(stripeDisputes.stripeDisputeId, input.stripeDisputeId));
}

/** An Admission Exception: the operator's record excepting one named event. */
export type AdmissionExceptionRecord = {
  id: string;
  userId: string;
  blockKind: "dispute";
  event: string;
  grantedAt: Date;
};

/**
 * Write an Admission Exception, or return the one already naming this event,
 * so a retried Operator Action never writes a second record.
 */
export async function grantAdmissionException(input: {
  userId: string;
  blockKind: "dispute";
  event: string;
  grantedAt: Date;
}): Promise<AdmissionExceptionRecord> {
  await getDb().insert(admissionExceptions).values(input).onConflictDoNothing();
  const [row] = await getDb()
    .select()
    .from(admissionExceptions)
    .where(
      and(
        eq(admissionExceptions.blockKind, input.blockKind),
        eq(admissionExceptions.event, input.event),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Failed to write the Admission Exception.");
  return row;
}

/**
 * The blocks that revoke Paid Access from one subscription (#617): every
 * refund made under a Refund record naming it, which admits no exception, and
 * every dispute on it, with the exceptions that name that dispute. A
 * subscription admits only while all of them are excepted (ADR 0248).
 */
export async function listSubscriptionRevocationBlocks(input: {
  stripeSubscriptionId: string;
}): Promise<AdmissionBlock[]> {
  const db = getDb();
  const [refunds, disputes] = await Promise.all([
    db
      .select({ id: refundRecords.id })
      .from(refundRecords)
      .where(
        and(
          eq(refundRecords.stripeSubscriptionId, input.stripeSubscriptionId),
          isNotNull(refundRecords.stripeRefundId),
        ),
      ),
    db
      .select({
        stripeDisputeId: stripeDisputes.stripeDisputeId,
        exceptionEvent: admissionExceptions.event,
      })
      .from(stripeDisputes)
      .leftJoin(
        admissionExceptions,
        and(
          eq(admissionExceptions.blockKind, "dispute"),
          eq(admissionExceptions.event, stripeDisputes.stripeDisputeId),
        ),
      )
      .where(eq(stripeDisputes.stripeSubscriptionId, input.stripeSubscriptionId)),
  ]);
  return [
    ...refunds.map((refund) => ({ kind: "refund", event: refund.id, exceptions: [] })),
    ...disputes.map((dispute) => ({
      kind: "dispute",
      event: dispute.stripeDisputeId,
      exceptions: dispute.exceptionEvent ? [{ event: dispute.exceptionEvent }] : [],
    })),
  ];
}

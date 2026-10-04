import type { RefundRecord } from "@tendnote/db/queries/paid-access-revocations";
import type { SuspensionCredit } from "@tendnote/db/queries/suspension-credits";
import {
  type OperatorRecord,
  type OperatorRecordKind,
  terminationRetentionDeadline,
} from "@tendnote/domain";
import type {
  StripeRefundRecord,
  StripeSuspensionCredit,
} from "@/lib/billing/operator-record-metadata";

/**
 * What re-recording a missing Operator Action reads and writes (#723). Each
 * write puts one record under the id the journal names, unless a record is
 * already there, and says whether it wrote. The reads are Stripe's; nothing
 * here asks Stripe to move money or change anything.
 */
export type OperatorRecordRestore = {
  rerecordTermination: (input: {
    id: string;
    userId: string;
    reason: string;
    terminatedAt: Date;
    retentionDeadline: Date;
  }) => Promise<boolean>;
  /** Lifts the suspension the id names, if it is still open. */
  rerecordSuspensionLift: (input: {
    id: string;
    userId: string;
    liftedAt: Date;
  }) => Promise<boolean>;
  rerecordRefund: (record: RefundRecord) => Promise<boolean>;
  rerecordSuspensionCredit: (record: SuspensionCredit) => Promise<boolean>;
  /** The Stripe refund carrying this record, created no earlier than `createdSince`. */
  findStripeRefund: (input: {
    refundRecordId: string;
    createdSince: Date;
  }) => Promise<StripeRefundRecord | null>;
  /** The credit note on the account's Stripe customer carrying this record. */
  findStripeSuspensionCredit: (input: {
    userId: string;
    suspensionCreditId: string;
  }) => Promise<StripeSuspensionCredit | null>;
};

/**
 * The reason a re-recorded Termination carries: the journal holds none, so the
 * operator keeps the original in the Incident Record.
 */
export const RERECORDED_TERMINATION_REASON =
  "Re-recorded by a restore from the Recovery Journal; the original reason is in the Incident Record.";

/**
 * How far before its journal time a Stripe object made for the record is still
 * looked for. The record is journaled before the Stripe call, so this only
 * covers the two clocks disagreeing; the match itself is on the record's id.
 */
const STRIPE_CLOCK_SKEW_MS = 60 * 60 * 1000;

type Rerecord = (store: OperatorRecordRestore, record: OperatorRecord) => Promise<boolean>;

/**
 * How each kind whose Operator Action cannot safely be run again is
 * re-recorded under the journal's action id and time; every other kind is the
 * operator's. Each says whether it wrote. Keeping the id takes the action off
 * the missing list, and lets the email fences copied in from production, which
 * are keyed by record id, silence any confirmation the Stripe replay would
 * otherwise send again.
 *
 * A refund or Suspension Credit is rebuilt from the Stripe object that carries
 * its record; one made before they carried it is not found, and stays for the
 * operator. A Termination is rebuilt from the journal alone, so its retention
 * deadline runs from when it happened.
 */
const RERECORD: Partial<Record<OperatorRecordKind, Rerecord>> = {
  termination: (store, { actionId: id, accountId: userId, at }) =>
    store.rerecordTermination({
      id,
      userId,
      reason: RERECORDED_TERMINATION_REASON,
      terminatedAt: at,
      retentionDeadline: terminationRetentionDeadline(at),
    }),
  "suspension-lift": (store, { actionId: id, accountId: userId, at }) =>
    store.rerecordSuspensionLift({ id, userId, liftedAt: at }),
  refund: async (store, { actionId: id, accountId: userId, at }) => {
    const refund = await store.findStripeRefund({
      refundRecordId: id,
      createdSince: new Date(at.getTime() - STRIPE_CLOCK_SKEW_MS),
    });
    if (!refund) return false;
    return store.rerecordRefund({ ...refund, userId, requestedAt: at, revokedAt: null });
  },
  "suspension-credit": async (store, { actionId: id, accountId: userId, at }) => {
    const credit = await store.findStripeSuspensionCredit({ userId, suspensionCreditId: id });
    if (!credit) return false;
    return store.rerecordSuspensionCredit({ ...credit, userId, requestedAt: at });
  },
};

/** The re-recording for this kind, or `undefined` when the operator handles it. */
export function rerecordingFor(kind: OperatorRecordKind): Rerecord | undefined {
  return RERECORD[kind];
}

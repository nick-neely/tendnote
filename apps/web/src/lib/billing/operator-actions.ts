import type { RefundRecord } from "@tendnote/db/queries/paid-access-revocations";
import type { AccessProfile, RecoveryJournal } from "@tendnote/domain";
import type Stripe from "stripe";
import { type LegalHoldDependencies, placeLegalHold } from "../access/legal-hold";
import {
  liftSuspension,
  renewSuspensionReview,
  suspendAccount,
  type TemporarySuspensionDependencies,
} from "../access/temporary-suspension";
import {
  refuseTerminated,
  type TerminationDependencies,
  terminateAccount,
} from "../access/termination";
import {
  type AccountCeilingOverrideDependencies,
  raiseAccountCeiling,
} from "./account-ceiling-override";
import { type DunningExtensionDependencies, extendDunning } from "./dunning-extension";
import { invoiceSubscription, stripeId } from "./first-paid-invoice";
import {
  applyStripeRefund,
  isSubscriptionRevoked,
  type PaidAccessRevocationDependencies,
  type RefundSnapshot,
} from "./paid-access-revocation";
import { projectSubscription, type SubscriptionSnapshot } from "./subscription-projection";
import { issueSuspensionCredit, type SuspensionCreditDependencies } from "./suspension-credit";

/** A paid invoice a Refund can return money from, read from Stripe. */
export type RefundableInvoice = {
  invoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  paymentIntentId: string;
  amountPaid: number;
};

/** The refundable parts of a paid subscription invoice read with its payments expanded. */
export function refundableInvoice(invoice: Stripe.Invoice): RefundableInvoice {
  const owner = invoiceSubscription(invoice);
  const payment = invoice.payments?.data.find((each) => each.status === "paid");
  const paymentIntentId = stripeId(payment?.payment.payment_intent ?? null);
  if (invoice.status !== "paid" || !invoice.id || !owner || !paymentIntentId) {
    throw new Error(`Invoice ${invoice.id} is not a card-paid subscription invoice.`);
  }
  return { invoiceId: invoice.id, ...owner, paymentIntentId, amountPaid: invoice.amount_paid };
}

export type OperatorActionDependencies = PaidAccessRevocationDependencies &
  TemporarySuspensionDependencies &
  TerminationDependencies &
  SuspensionCreditDependencies &
  DunningExtensionDependencies &
  AccountCeilingOverrideDependencies &
  LegalHoldDependencies & {
    /** One suspension by id, such as the one a Termination converted. */
    getSuspension: (input: { userId: string; id: string }) => Promise<{ suspendedAt: Date } | null>;
    journal: RecoveryJournal;
    /** The Operator Action records (ADR 0248), written before any Stripe call. */
    records: {
      /** The newest Refund record naming this invoice, if any. */
      findRefundRecordForInvoice: (input: { invoiceId: string }) => Promise<RefundRecord | null>;
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
 * One Refund per invoice. Running it again resumes an unfinished record under
 * the same idempotency key, so Stripe answers with the refund it already made
 * rather than a second one, and an invoice already refunded is refused. A
 * refund Stripe reports failed leaves the record open and revokes nothing.
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

  const record = await openRefundRecord(deps, { ...invoice, userId, amount, now: input.now });
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
  const outcome = await applyRefundOf(deps, record.id, refund, input.now);
  return { refundRecordId: record.id, stripeRefundId: refund.id, outcome };
}

/** The invoice's unfinished Refund record to resume, or a new one; never a second refund. */
async function openRefundRecord(
  deps: OperatorActionDependencies,
  input: RefundableInvoice & { userId: string; amount: number; now?: Date },
): Promise<{ id: string; requestedAt: Date }> {
  const existing = await deps.records.findRefundRecordForInvoice({ invoiceId: input.invoiceId });
  if (existing?.stripeRefundId) {
    throw new Error(
      `Invoice ${input.invoiceId} was already refunded as ${existing.stripeRefundId} under Refund record ${existing.id}.`,
    );
  }
  if (existing && existing.amount !== input.amount) {
    throw new Error(
      `Refund record ${existing.id} for ${input.invoiceId} is unfinished for ${existing.amount}; run it again with that amount.`,
    );
  }
  return (
    existing ??
    deps.records.recordRefund({
      userId: input.userId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      invoiceId: input.invoiceId,
      paymentIntentId: input.paymentIntentId,
      amount: input.amount,
      requestedAt: input.now ?? new Date(),
    })
  );
}

/** Store the refund on its record and apply it, unless no money went back. */
async function applyRefundOf(
  deps: OperatorActionDependencies,
  refundRecordId: string,
  refund: RefundSnapshot,
  now: Date | undefined,
) {
  if (refund.status === "failed" || refund.status === "canceled") return "not_refunded" as const;
  await deps.revocations.attachStripeRefund({ id: refundRecordId, stripeRefundId: refund.id });
  return applyStripeRefund(deps, refund, now);
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
 * A terminated account is refused before anything is written: its
 * Termination stopped the renewal, and nothing re-admits it.
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
  await refuseTerminated(deps.terminations, userId);
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

/**
 * Lift a suspension, then issue its Suspension Credit (#631) for the time from
 * the suspension's start to the lift. The lift commits and is journaled first,
 * so a Stripe failure never leaves a customer suspended; running it again
 * resumes the lift and finishes the credit.
 */
export async function liftSuspensionWithCredit(
  deps: OperatorActionDependencies,
  input: { userId: string; now?: Date },
) {
  const lift = await liftSuspension(deps, input);
  const suspensionCredits = await issueSuspensionCredit(
    deps,
    {
      userId: input.userId,
      suspensionId: lift.suspensionId,
      suspendedAt: lift.suspendedAt,
      exitAt: lift.liftedAt,
      terminationId: null,
    },
    input.now,
  );
  return { ...lift, suspensionCredits };
}

/**
 * Terminate an account, then, when the termination converted an open
 * suspension, issue that suspension's Suspension Credit (#631): the suspended
 * time and the unused remainder to the period end, on one credit note per paid
 * invoice and always back to the card. A termination that converted no
 * suspension issues none. The termination commits and stops the renewal
 * first; running it again resumes both.
 */
export async function terminateAccountWithCredit(
  deps: OperatorActionDependencies,
  input: { userId: string; reason: string; now?: Date },
) {
  const termination = await terminateAccount(deps, input);
  const suspensionId = termination.convertedSuspensionId;
  if (!suspensionId) return { ...termination, suspensionCredits: [] };
  const converted = await deps.getSuspension({ userId: input.userId, id: suspensionId });
  if (!converted) throw new Error(`Suspension ${suspensionId} is not on record.`);
  const suspensionCredits = await issueSuspensionCredit(
    deps,
    {
      userId: input.userId,
      suspensionId,
      suspendedAt: converted.suspendedAt,
      exitAt: termination.terminatedAt,
      terminationId: termination.terminationId,
    },
    input.now,
  );
  return { ...termination, suspensionCredits };
}

export const OPERATOR_USAGE = `Usage:
  operator refund <invoice id> [amount in cents]
  operator readmit-dispute <dispute id>
  operator extend-dunning <invoice id> <days>
  operator raise-ceiling <user id> <interactive|background|web_search> <dollars>
  operator suspend <user id> <reason>
  operator renew-suspension <user id>
  operator lift-suspension <user id>
  operator terminate <user id> <reason>
  operator legal-hold <user id> <expiry date, YYYY-MM-DD>`;

/** A whole number of days, as an operator types one. */
const WHOLE_NUMBER = /^\d+$/;
/** An amount in dollars, as an operator types one: `20` or `1.75`. */
const DOLLARS = /^\d+(\.\d+)?$/;

type OperatorCommand = {
  /** Whether the arguments after the id are acceptable. */
  accepts: (rest: readonly string[]) => boolean;
  run: (deps: OperatorActionDependencies, id: string, rest: readonly string[]) => Promise<unknown>;
};

const OPERATOR_COMMANDS: Record<string, OperatorCommand> = {
  refund: {
    accepts: (rest) => rest.length <= 1,
    run: (deps, invoiceId, [amount]) =>
      refundInvoice(deps, { invoiceId, amount: amount === undefined ? undefined : Number(amount) }),
  },
  "readmit-dispute": {
    accepts: (rest) => rest.length === 0,
    run: (deps, stripeDisputeId) => readmitAfterWonDispute(deps, { stripeDisputeId }),
  },
  "extend-dunning": {
    accepts: (rest) => rest.length === 1 && WHOLE_NUMBER.test(rest[0] ?? ""),
    run: (deps, invoiceId, [days]) => extendDunning(deps, { invoiceId, days: Number(days) }),
  },
  "raise-ceiling": {
    accepts: (rest) => rest.length === 2 && DOLLARS.test(rest[1] ?? ""),
    run: (deps, userId, [category = "", dollars]) =>
      raiseAccountCeiling(deps, { userId, category, ceilingUsd: Number(dollars) }),
  },
  suspend: {
    accepts: (rest) => rest.length > 0,
    run: (deps, userId, reason) => suspendAccount(deps, { userId, reason: reason.join(" ") }),
  },
  "renew-suspension": {
    accepts: (rest) => rest.length === 0,
    run: (deps, userId) => renewSuspensionReview(deps, { userId }),
  },
  "lift-suspension": {
    accepts: (rest) => rest.length === 0,
    run: (deps, userId) => liftSuspensionWithCredit(deps, { userId }),
  },
  terminate: {
    accepts: (rest) => rest.length > 0,
    run: (deps, userId, reason) =>
      terminateAccountWithCredit(deps, { userId, reason: reason.join(" ") }),
  },
  "legal-hold": {
    accepts: (rest) => rest.length === 1,
    run: (deps, userId, [expiresOn = ""]) => placeLegalHold(deps, { userId, expiresOn }),
  },
};

/** One Operator Action from the operator CLI's arguments; anything else is refused with the usage. */
export function runOperatorCommand(
  deps: OperatorActionDependencies,
  [action, id, ...rest]: readonly string[],
): Promise<unknown> {
  const command =
    action && Object.hasOwn(OPERATOR_COMMANDS, action) ? OPERATOR_COMMANDS[action] : undefined;
  if (!command || !id || !command.accepts(rest)) return Promise.reject(new Error(OPERATOR_USAGE));
  return command.run(deps, id, rest);
}

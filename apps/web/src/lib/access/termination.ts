import type { Termination } from "@tendnote/db/queries/terminations";
import { type RecoveryJournal, terminationRetentionDeadline } from "@tendnote/domain";
import {
  projectSubscription,
  type SubscriptionProjectionDependencies,
  type SubscriptionSnapshot,
} from "../billing/subscription-projection";
import type { TemporarySuspensionDependencies } from "./temporary-suspension";

/**
 * What the Termination Operator Action touches (#630): its record, any open
 * suspension it converts, the Recovery Journal, the account's sessions, and the
 * one Stripe call that stops the subscription renewing.
 */
export type TerminationDependencies = {
  journal: RecoveryJournal;
  terminations: {
    findTermination: (input: { userId: string }) => Promise<Termination | null>;
    recordTermination: (input: {
      userId: string;
      reason: string;
      terminatedAt: Date;
      retentionDeadline: Date;
      suspensionId: string | null;
    }) => Promise<Termination>;
    attachTerminationSubscription: (input: {
      id: string;
      stripeSubscriptionId: string;
    }) => Promise<void>;
  };
  suspensions: Pick<TemporarySuspensionDependencies["suspensions"], "findOpenSuspension">;
  revokeSessions: TemporarySuspensionDependencies["revokeSessions"];
  /** The account's live subscription, read locally; `null` when it has none. */
  findLiveSubscription: (input: {
    userId: string;
  }) => Promise<{ stripeSubscriptionId: string } | null>;
  retrieveSubscription: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  /** Stop a subscription renewing: Stripe cancels it at its period end. */
  stopRenewal: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  /** End a subscription in Stripe at once, which stops its payment retries. */
  cancelSubscription: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  subscriptions: SubscriptionProjectionDependencies;
};

/**
 * Terminate an account: permanent, and admitting no exception (ADR 0248). The
 * record commits first, and from that moment admission is denied on Web and
 * Eve and the ninety-day retention clock runs from the stored deadline. Every
 * session is revoked next, so the next sign-in lands in the restricted area
 * with export and deletion only, then the record is journaled. Only then is
 * Stripe asked to stop the subscription renewing, and the subscription is
 * stored on the record afterwards. A Past Due subscription is ended at once
 * instead, as a closed dunning window ends one, so Stripe never retries its
 * failed renewal against a terminated account. Household memberships are left exactly as
 * they are; the block alone denies household access.
 *
 * An open Temporary Suspension is converted: the termination names it and is
 * its audited end. Running it again on a terminated account resumes the
 * termination under its original record, reason, and deadline, and `resumed`
 * says so.
 */
export async function terminateAccount(
  deps: TerminationDependencies,
  input: { userId: string; reason: string; now?: Date },
) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A termination needs a reason.");
  const now = input.now ?? new Date();

  const existing = await deps.terminations.findTermination({ userId: input.userId });
  const termination =
    existing ??
    (await deps.terminations.recordTermination({
      userId: input.userId,
      reason,
      terminatedAt: now,
      retentionDeadline: terminationRetentionDeadline(now),
      suspensionId:
        (await deps.suspensions.findOpenSuspension({ userId: input.userId }))?.id ?? null,
    }));
  await deps.revokeSessions({ userId: input.userId });
  await deps.journal.write({
    kind: "termination",
    accountId: input.userId,
    actionId: termination.id,
    at: termination.terminatedAt,
  });
  const stripeSubscriptionId = await cancelRenewal(deps, termination);

  return {
    terminationId: termination.id,
    terminatedAt: termination.terminatedAt,
    retentionDeadline: termination.retentionDeadline,
    convertedSuspensionId: termination.suspensionId,
    stripeSubscriptionId,
    resumed: existing !== null,
  };
}

/**
 * Stop the live subscription renewing, unless it already ends, and store it on
 * the termination. Returns the subscription, or `null` when none was live.
 */
async function cancelRenewal(
  deps: TerminationDependencies,
  termination: Termination,
): Promise<string | null> {
  const { userId } = termination;
  const live = await deps.findLiveSubscription({ userId });
  if (!live) return null;

  let subscription = await deps.retrieveSubscription(live.stripeSubscriptionId);
  if (subscription.endedAt) {
    await projectSubscription(deps.subscriptions, userId, subscription);
    return null;
  }
  if (subscription.pastDue) {
    subscription = await deps.cancelSubscription(subscription.id);
  } else if (!subscription.cancelAt) {
    subscription = await deps.stopRenewal(subscription.id);
  }
  await deps.terminations.attachTerminationSubscription({
    id: termination.id,
    stripeSubscriptionId: subscription.id,
  });
  await projectSubscription(deps.subscriptions, userId, subscription);
  return subscription.id;
}

/** Refuse an Operator Action that would act on a terminated account as if it could return. */
export async function refuseTerminated(
  terminations: Pick<TerminationDependencies["terminations"], "findTermination">,
  userId: string,
): Promise<void> {
  if (await terminations.findTermination({ userId })) {
    throw new Error(`Account ${userId} is terminated; a termination is permanent.`);
  }
}

import type { TemporarySuspension } from "@tendnote/db/queries/temporary-suspensions";
import { type RecoveryJournal, suspensionReviewDeadline } from "@tendnote/domain";
import { refuseTerminated, type TerminationDependencies } from "./termination";

/**
 * What the Temporary Suspension Operator Actions touch (#629): the suspension
 * records, the Recovery Journal, and the account's sessions. Nothing here can
 * reach Stripe: the subscription stays active, invoices are paid, and dunning
 * runs as usual, because admission is denied by the record alone. The
 * Suspension Credit issued after a lift is its own Operator Action (#631). None of
 * them acts on a terminated account: its Termination ended any suspension.
 */
export type TemporarySuspensionDependencies = {
  journal: RecoveryJournal;
  suspensions: {
    findOpenSuspension: (input: { userId: string }) => Promise<TemporarySuspension | null>;
    findLatestSuspension: (input: { userId: string }) => Promise<TemporarySuspension | null>;
    recordSuspension: (input: {
      userId: string;
      reason: string;
      suspendedAt: Date;
      reviewDeadline: Date;
    }) => Promise<TemporarySuspension>;
    renewSuspensionDeadline: (input: {
      suspensionId: string;
      reason: string;
      reviewDeadline: Date;
      renewedAt: Date;
    }) => Promise<void>;
    liftSuspension: (input: { id: string; at: Date }) => Promise<TemporarySuspension | null>;
  };
  terminations: Pick<TerminationDependencies["terminations"], "findTermination">;
  /** Ends every session the account holds. Safe to repeat. */
  revokeSessions: (input: { userId: string }) => Promise<void>;
};

/**
 * Place a Temporary Suspension. The record commits first, and from that moment
 * admission is denied on Web and Eve with no exceptions (ADR 0248). Every
 * session is revoked next, so the next sign-in lands in the restricted area,
 * and then the record is journaled; a journal outage never leaves a session
 * alive. Household memberships are left exactly as they are.
 *
 * Running it again on an account already suspended resumes that suspension,
 * journaling it and revoking sessions again, rather than opening a second; the
 * open suspension keeps its original reason, and `resumed` says so.
 */
export async function suspendAccount(
  deps: TemporarySuspensionDependencies,
  input: { userId: string; reason: string; now?: Date },
) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A suspension needs a reason.");
  const now = input.now ?? new Date();
  await refuseTerminated(deps.terminations, input.userId);

  const open = await deps.suspensions.findOpenSuspension({ userId: input.userId });
  const suspension =
    open ??
    (await deps.suspensions.recordSuspension({
      userId: input.userId,
      reason,
      suspendedAt: now,
      reviewDeadline: suspensionReviewDeadline(now),
    }));
  await deps.revokeSessions({ userId: input.userId });
  await deps.journal.write({
    kind: "suspension",
    accountId: input.userId,
    actionId: suspension.id,
    at: suspension.suspendedAt,
  });

  return {
    suspensionId: suspension.id,
    suspendedAt: suspension.suspendedAt,
    reviewDeadline: suspension.reviewDeadline,
    resumed: open !== null,
  };
}

/**
 * Renew an open suspension's internal review deadline to ten business days
 * from now. Each renewal is its own audited record carrying the operator's
 * reason for renewing, so a run of renewals can be reviewed and never licenses
 * an indefinite suspension (#740); admission is unchanged.
 */
export async function renewSuspensionReview(
  deps: TemporarySuspensionDependencies,
  input: { userId: string; reason: string; now?: Date },
) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A renewal needs a reason.");
  const now = input.now ?? new Date();
  await refuseTerminated(deps.terminations, input.userId);
  const open = await deps.suspensions.findOpenSuspension({ userId: input.userId });
  if (!open) throw new Error(`Account ${input.userId} has no open suspension.`);

  const reviewDeadline = suspensionReviewDeadline(now);
  await deps.suspensions.renewSuspensionDeadline({
    suspensionId: open.id,
    reason,
    reviewDeadline,
    renewedAt: now,
  });
  return { suspensionId: open.id, reason, previousDeadline: open.reviewDeadline, reviewDeadline };
}

/**
 * Lift a suspension: the audited transition that restores admission. The lift
 * is recorded on the suspension, then journaled, so a restore never brings back
 * a suspension that was lifted. Whatever else is true of the account still
 * applies: one that lapsed during the review lands in the Lapsed area.
 *
 * Running it again after the journal write failed resumes the newest lift
 * under the same journal entry.
 */
export async function liftSuspension(
  deps: TemporarySuspensionDependencies,
  input: { userId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  await refuseTerminated(deps.terminations, input.userId);
  const open = await deps.suspensions.findOpenSuspension({ userId: input.userId });
  const lifted =
    (open && (await deps.suspensions.liftSuspension({ id: open.id, at: now }))) ??
    (await deps.suspensions.findLatestSuspension({ userId: input.userId }));
  if (!lifted?.liftedAt) throw new Error(`Account ${input.userId} has no suspension to lift.`);

  await deps.journal.write({
    kind: "suspension-lift",
    accountId: input.userId,
    actionId: lifted.id,
    at: lifted.liftedAt,
  });
  return {
    suspensionId: lifted.id,
    suspendedAt: lifted.suspendedAt,
    liftedAt: lifted.liftedAt,
    resumed: open === null,
  };
}

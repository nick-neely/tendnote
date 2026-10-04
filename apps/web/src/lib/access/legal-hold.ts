import type { LegalHold } from "@tendnote/db/queries/legal-holds";
import type { RecoveryJournal } from "@tendnote/domain";

/** What the Legal Hold Operator Action touches (#632): its record and the journal. */
export type LegalHoldDependencies = {
  journal: RecoveryJournal;
  legalHolds: {
    recordLegalHold: (input: {
      userId: string;
      expiresAt: Date;
      placedAt: Date;
    }) => Promise<LegalHold>;
  };
};

/** A calendar date, as an operator types one. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The start of `date` in UTC, or `null` if it is not a real calendar date. */
function startOfUtcDate(date: string): Date | null {
  if (!ISO_DATE.test(date)) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  return start.toISOString().startsWith(date) ? start : null;
}

/**
 * Place a Legal Hold (#632, ADR 0260). The account's data may not be purged
 * until the hold expires at the start of `expiresOn` in UTC: an owner's
 * deletion request still closes the account and stops billing, but the rows
 * stay until the hold ends, and a Lapsed or Terminated account's deletion
 * notices pause. Nothing else about the account changes, and nothing reaches
 * Stripe. The record is written, then journaled.
 *
 * A hold cannot be shortened. A later expiry is a second hold, and the latest
 * expiry governs. Running the same hold again journals the same record again,
 * which is how a failed journal write is finished.
 */
export async function placeLegalHold(
  deps: LegalHoldDependencies,
  input: { userId: string; expiresOn: string; now?: Date },
) {
  const expiresAt = startOfUtcDate(input.expiresOn);
  if (!expiresAt) throw new Error("A Legal Hold expires on a date, such as 2027-01-31.");
  const now = input.now ?? new Date();
  if (expiresAt <= now)
    throw new Error(`A Legal Hold expiring ${input.expiresOn} is already over.`);

  const hold = await deps.legalHolds.recordLegalHold({
    userId: input.userId,
    expiresAt,
    placedAt: now,
  });
  // The hold is in force once its row commits. A restore only finds it
  // through the journal, so a failed write must be retried, not left alone.
  try {
    await deps.journal.write({
      kind: "legal-hold",
      accountId: hold.userId,
      actionId: hold.id,
      at: hold.placedAt,
    });
  } catch (error) {
    throw new Error(
      `Legal Hold ${hold.id} is in force but not yet journaled, so a restore would lose it. Run the same command again until it succeeds.`,
      { cause: error },
    );
  }
  return { holdId: hold.id, userId: hold.userId, heldUntil: hold.expiresAt };
}

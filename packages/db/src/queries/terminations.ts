import type { AdmissionBlock } from "@tendnote/domain";
import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { terminations } from "../schema";

/**
 * A Termination Operator Action's record (#630). The operator's reason is
 * deliberately not read back here.
 */
export type Termination = {
  id: string;
  userId: string;
  terminatedAt: Date;
  retentionDeadline: Date;
  suspensionId: string | null;
  stripeSubscriptionId: string | null;
};

const terminationColumns = {
  id: terminations.id,
  userId: terminations.userId,
  terminatedAt: terminations.terminatedAt,
  retentionDeadline: terminations.retentionDeadline,
  suspensionId: terminations.suspensionId,
  stripeSubscriptionId: terminations.stripeSubscriptionId,
};

/** The account's termination, if it has one. A local read; never Stripe. */
export async function findTermination(input: { userId: string }): Promise<Termination | null> {
  const [row] = await getDb()
    .select(terminationColumns)
    .from(terminations)
    .where(eq(terminations.userId, input.userId))
    .limit(1);
  return row ?? null;
}

/** Write a termination record. It must commit before anything else the action does. */
export async function recordTermination(input: {
  userId: string;
  reason: string;
  terminatedAt: Date;
  retentionDeadline: Date;
  suspensionId: string | null;
}): Promise<Termination> {
  const [row] = await getDb().insert(terminations).values(input).returning(terminationColumns);
  if (!row) throw new Error("Failed to write the termination record.");
  return row;
}

/** Store the subscription whose renewal the termination stopped, once Stripe has stopped it. */
export async function attachTerminationSubscription(input: {
  id: string;
  stripeSubscriptionId: string;
}): Promise<void> {
  await getDb()
    .update(terminations)
    .set({ stripeSubscriptionId: input.stripeSubscriptionId })
    .where(eq(terminations.id, input.id));
}

/** The admission block a termination raises. It admits no exception and never ends (ADR 0248). */
export function terminationAdmissionBlocks(
  termination: Pick<Termination, "id"> | null,
): AdmissionBlock[] {
  return termination ? [{ kind: "termination", event: termination.id, exceptions: [] }] : [];
}

/** The account's termination block, read from its termination record. */
export async function listTerminationAdmissionBlocks(input: {
  userId: string;
}): Promise<AdmissionBlock[]> {
  return terminationAdmissionBlocks(await findTermination(input));
}

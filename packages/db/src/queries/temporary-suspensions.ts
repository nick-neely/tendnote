import type { AdmissionBlock } from "@tendnote/domain";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../client";
import { suspensionDeadlineRenewals, temporarySuspensions } from "../schema";

/**
 * A Temporary Suspension Operator Action's record (#629). `reviewDeadline` is
 * the deadline in force: the newest renewal's, or the one set on suspension.
 * The operator's reason is deliberately not read back here.
 */
export type TemporarySuspension = {
  id: string;
  userId: string;
  suspendedAt: Date;
  reviewDeadline: Date;
  liftedAt: Date | null;
};

const suspensionColumns = {
  id: temporarySuspensions.id,
  userId: temporarySuspensions.userId,
  suspendedAt: temporarySuspensions.suspendedAt,
  reviewDeadline: temporarySuspensions.reviewDeadline,
  liftedAt: temporarySuspensions.liftedAt,
};

async function withDeadlineInForce(
  suspension: TemporarySuspension | undefined,
): Promise<TemporarySuspension | null> {
  if (!suspension) return null;
  const [renewal] = await getDb()
    .select({ reviewDeadline: suspensionDeadlineRenewals.reviewDeadline })
    .from(suspensionDeadlineRenewals)
    .where(eq(suspensionDeadlineRenewals.suspensionId, suspension.id))
    .orderBy(desc(suspensionDeadlineRenewals.renewedAt))
    .limit(1);
  return renewal ? { ...suspension, reviewDeadline: renewal.reviewDeadline } : suspension;
}

/** The account's open suspension, if it has one. A local read; never Stripe. */
export async function findOpenSuspension(input: {
  userId: string;
}): Promise<TemporarySuspension | null> {
  const [row] = await getDb()
    .select(suspensionColumns)
    .from(temporarySuspensions)
    .where(
      and(eq(temporarySuspensions.userId, input.userId), isNull(temporarySuspensions.liftedAt)),
    )
    .limit(1);
  return withDeadlineInForce(row);
}

/** The account's newest suspension, open or lifted, so an interrupted lift can be resumed. */
export async function findLatestSuspension(input: {
  userId: string;
}): Promise<TemporarySuspension | null> {
  const [row] = await getDb()
    .select(suspensionColumns)
    .from(temporarySuspensions)
    .where(eq(temporarySuspensions.userId, input.userId))
    .orderBy(desc(temporarySuspensions.suspendedAt))
    .limit(1);
  return withDeadlineInForce(row);
}

/** Write a suspension record. It must commit before anything else the action does. */
export async function recordSuspension(input: {
  userId: string;
  reason: string;
  suspendedAt: Date;
  reviewDeadline: Date;
}): Promise<TemporarySuspension> {
  const [row] = await getDb()
    .insert(temporarySuspensions)
    .values(input)
    .returning(suspensionColumns);
  if (!row) throw new Error("Failed to write the suspension record.");
  return row;
}

/** Record a renewal of an open suspension's review deadline. */
export async function renewSuspensionDeadline(input: {
  suspensionId: string;
  reviewDeadline: Date;
  renewedAt: Date;
}): Promise<void> {
  await getDb().insert(suspensionDeadlineRenewals).values(input);
}

/**
 * Lift a suspension: the audited transition that ends it. A suspension keeps
 * the first lift time it is given, so a repeated lift returns `null`.
 */
export async function liftSuspension(input: {
  id: string;
  at: Date;
}): Promise<TemporarySuspension | null> {
  const [row] = await getDb()
    .update(temporarySuspensions)
    .set({ liftedAt: input.at })
    .where(and(eq(temporarySuspensions.id, input.id), isNull(temporarySuspensions.liftedAt)))
    .returning(suspensionColumns);
  return withDeadlineInForce(row);
}

/**
 * The admission block an open suspension raises. It admits no exception: only
 * its own lift ends it (ADR 0248).
 */
export function temporarySuspensionAdmissionBlocks(
  suspension: Pick<TemporarySuspension, "id"> | null,
): AdmissionBlock[] {
  return suspension ? [{ kind: "temporary_suspension", event: suspension.id, exceptions: [] }] : [];
}

/** The account's suspension block, read from its open suspension. */
export async function listSuspensionAdmissionBlocks(input: {
  userId: string;
}): Promise<AdmissionBlock[]> {
  return temporarySuspensionAdmissionBlocks(await findOpenSuspension(input));
}

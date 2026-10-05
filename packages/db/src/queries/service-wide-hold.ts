import { desc, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../client";
import { serviceWideHolds } from "../schema";

/**
 * A Service-Wide Hold's record (#634). The operator's reason is deliberately
 * not read back here.
 */
export type ServiceWideHold = { id: string; placedAt: Date; liftedAt: Date | null };

const holdColumns = {
  id: serviceWideHolds.id,
  placedAt: serviceWideHolds.placedAt,
  liftedAt: serviceWideHolds.liftedAt,
};

/** The open hold, if one is in force. */
export async function findOpenServiceWideHold(): Promise<ServiceWideHold | null> {
  const [row] = await getDb()
    .select(holdColumns)
    .from(serviceWideHolds)
    .where(isNull(serviceWideHolds.liftedAt))
    .limit(1);
  return row ?? null;
}

/** Whether a hold is in force: the product, export, deletion, and background work all wait. */
export async function isServiceWideHoldActive(): Promise<boolean> {
  return Boolean(await findOpenServiceWideHold());
}

/** Writes a new open hold. The one-open index refuses a second. */
export async function recordServiceWideHold(input: {
  reason: string;
  placedAt: Date;
}): Promise<ServiceWideHold> {
  const [row] = await getDb().insert(serviceWideHolds).values(input).returning(holdColumns);
  if (!row) throw new Error("The Service-Wide Hold was not recorded.");
  return row;
}

/** Lifts the open hold, returning it, or `null` when none is open. */
export async function liftServiceWideHold(input: { at: Date }): Promise<ServiceWideHold | null> {
  const [row] = await getDb()
    .update(serviceWideHolds)
    .set({ liftedAt: input.at })
    .where(isNull(serviceWideHolds.liftedAt))
    .returning(holdColumns);
  return row ?? null;
}

/**
 * When the most recent hold was lifted, or `null` if none ever was. A deletion
 * intent's twenty-four-hour alert counts from here, because the hold made it wait.
 */
export async function findLatestServiceWideHoldLift(): Promise<Date | null> {
  const [row] = await getDb()
    .select({ liftedAt: serviceWideHolds.liftedAt })
    .from(serviceWideHolds)
    .where(isNotNull(serviceWideHolds.liftedAt))
    .orderBy(desc(serviceWideHolds.liftedAt))
    .limit(1);
  return row?.liftedAt ?? null;
}

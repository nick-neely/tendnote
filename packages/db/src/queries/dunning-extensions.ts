import { and, eq } from "drizzle-orm";
import { getDb } from "../client";
import { admissionExceptions } from "../schema";

/** The Admission Exception a dunning extension writes: it names the failed invoice. */
export type DunningExtension = {
  id: string;
  userId: string;
  invoiceId: string;
  expiresAt: Date;
  grantedAt: Date;
};

async function readDunningExtension(invoiceId: string): Promise<DunningExtension | null> {
  const [row] = await getDb()
    .select({
      id: admissionExceptions.id,
      userId: admissionExceptions.userId,
      invoiceId: admissionExceptions.event,
      expiresAt: admissionExceptions.expiresAt,
      grantedAt: admissionExceptions.grantedAt,
    })
    .from(admissionExceptions)
    .where(
      and(eq(admissionExceptions.blockKind, "dunning"), eq(admissionExceptions.event, invoiceId)),
    )
    .limit(1);
  if (!row?.expiresAt) return null;
  return { ...row, expiresAt: row.expiresAt };
}

/**
 * Write the dunning extension naming a failed invoice (#633, ADR 0248), or
 * return the one already naming it: an invoice's window is extended once, so a
 * retried Operator Action finds its own record and a second grant finds the
 * first.
 */
export async function grantDunningExtension(input: {
  userId: string;
  invoiceId: string;
  expiresAt: Date;
  grantedAt: Date;
}): Promise<DunningExtension> {
  await getDb()
    .insert(admissionExceptions)
    .values({
      userId: input.userId,
      blockKind: "dunning",
      event: input.invoiceId,
      expiresAt: input.expiresAt,
      grantedAt: input.grantedAt,
    })
    .onConflictDoNothing();
  const recorded = await readDunningExtension(input.invoiceId);
  if (!recorded) throw new Error("Failed to write the dunning extension.");
  return recorded;
}

/**
 * When the dunning window of this failed invoice now closes, if an extension
 * names it; `null` when none does. A later failed invoice has its own window,
 * which no earlier extension covers.
 */
export async function findDunningExtension(input: { invoiceId: string }): Promise<Date | null> {
  return (await readDunningExtension(input.invoiceId))?.expiresAt ?? null;
}

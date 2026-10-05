import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "../client";
import { suspensionCredits } from "../schema";

/** A Suspension Credit Operator Action's record (#631, ADR 0249). */
export type SuspensionCredit = {
  id: string;
  userId: string;
  suspensionId: string | null;
  terminationId: string | null;
  stripeSubscriptionId: string;
  invoiceId: string;
  invoiceLineItemId: string;
  paymentIntentId: string | null;
  suspendedAmount: number;
  remainderAmount: number;
  amount: number;
  instrument: "balance" | "card";
  requestedAt: Date;
  stripeCreditNoteId: string | null;
  stripeRefundId: string | null;
};

/** The exit a Suspension Credit was issued at: a lift, or a Termination. */
export type SuspensionExitRef = { suspensionId: string } | { terminationId: string };

const creditColumns = {
  id: suspensionCredits.id,
  userId: suspensionCredits.userId,
  suspensionId: suspensionCredits.suspensionId,
  terminationId: suspensionCredits.terminationId,
  stripeSubscriptionId: suspensionCredits.stripeSubscriptionId,
  invoiceId: suspensionCredits.invoiceId,
  invoiceLineItemId: suspensionCredits.invoiceLineItemId,
  paymentIntentId: suspensionCredits.paymentIntentId,
  suspendedAmount: suspensionCredits.suspendedAmount,
  remainderAmount: suspensionCredits.remainderAmount,
  amount: suspensionCredits.amount,
  instrument: suspensionCredits.instrument,
  requestedAt: suspensionCredits.requestedAt,
  stripeCreditNoteId: suspensionCredits.stripeCreditNoteId,
  stripeRefundId: suspensionCredits.stripeRefundId,
};

/** Every Suspension Credit issued at one exit, so a rerun resumes rather than credits twice. */
export async function listSuspensionCreditsForExit(
  exit: SuspensionExitRef,
): Promise<SuspensionCredit[]> {
  return getDb()
    .select(creditColumns)
    .from(suspensionCredits)
    .where(
      "terminationId" in exit
        ? eq(suspensionCredits.terminationId, exit.terminationId)
        : and(
            eq(suspensionCredits.suspensionId, exit.suspensionId),
            isNull(suspensionCredits.terminationId),
          ),
    );
}

/** Write a Suspension Credit record. It must commit before the credit note is created. */
export async function recordSuspensionCredit(
  input: Omit<SuspensionCredit, "id" | "stripeCreditNoteId" | "stripeRefundId">,
): Promise<SuspensionCredit> {
  const [row] = await getDb().insert(suspensionCredits).values(input).returning(creditColumns);
  if (!row) throw new Error("Failed to write the Suspension Credit record.");
  return row;
}

/** Store the credit note on its record. A record keeps the first one it is given. */
export async function attachSuspensionCreditNote(input: {
  id: string;
  stripeCreditNoteId: string;
}): Promise<void> {
  await getDb()
    .update(suspensionCredits)
    .set({ stripeCreditNoteId: input.stripeCreditNoteId })
    .where(and(eq(suspensionCredits.id, input.id), isNull(suspensionCredits.stripeCreditNoteId)));
}

/** Store the card refund a credit note made on its record. A record keeps the first one. */
export async function attachSuspensionCreditRefund(input: {
  id: string;
  stripeRefundId: string;
}): Promise<void> {
  await getDb()
    .update(suspensionCredits)
    .set({ stripeRefundId: input.stripeRefundId })
    .where(and(eq(suspensionCredits.id, input.id), isNull(suspensionCredits.stripeRefundId)));
}

/** The Suspension Credit a Stripe refund was matched to, by the refund's id. */
export async function getSuspensionCreditByStripeRefund(input: {
  stripeRefundId: string;
}): Promise<SuspensionCredit | null> {
  const [row] = await getDb()
    .select(creditColumns)
    .from(suspensionCredits)
    .where(eq(suspensionCredits.stripeRefundId, input.stripeRefundId))
    .limit(1);
  return row ?? null;
}

/**
 * The newest card Suspension Credit without a Stripe refund id that names this
 * payment and amount and was written inside the window: how a refund whose id
 * write was lost, or that Stripe announced before the credit note call
 * returned, is matched (ADR 0249).
 */
export async function findUnmatchedSuspensionCredit(input: {
  paymentIntentId: string;
  amount: number;
  requestedAtOrAfter: Date;
  requestedAtOrBefore: Date;
}): Promise<SuspensionCredit | null> {
  const [row] = await getDb()
    .select(creditColumns)
    .from(suspensionCredits)
    .where(
      and(
        eq(suspensionCredits.instrument, "card"),
        eq(suspensionCredits.paymentIntentId, input.paymentIntentId),
        eq(suspensionCredits.amount, input.amount),
        isNull(suspensionCredits.stripeRefundId),
        gte(suspensionCredits.requestedAt, input.requestedAtOrAfter),
        lte(suspensionCredits.requestedAt, input.requestedAtOrBefore),
      ),
    )
    .orderBy(desc(suspensionCredits.requestedAt))
    .limit(1);
  return row ?? null;
}

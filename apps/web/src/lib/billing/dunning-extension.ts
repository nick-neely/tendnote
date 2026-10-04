import type { DunningExtension } from "@tendnote/db/queries/dunning-extensions";
import type { PastDueSubscription } from "@tendnote/db/queries/stripe-subscriptions";
import { dunningExtensionExpiry, type RecoveryJournal } from "@tendnote/domain";

/** What the dunning extension Operator Action touches (#633): two records and the journal. */
export type DunningExtensionDependencies = {
  journal: RecoveryJournal;
  dunning: {
    findPastDueSubscription: (input: { invoiceId: string }) => Promise<PastDueSubscription | null>;
    grantDunningExtension: (input: {
      userId: string;
      invoiceId: string;
      expiresAt: Date;
      grantedAt: Date;
    }) => Promise<DunningExtension>;
  };
};

/**
 * Extend dunning once (#633, ADR 0248). The grant names the failed invoice of
 * a live Past Due subscription and moves that invoice's window to `days` past
 * its ordinary close; the reconciliation job ends the subscription only once
 * the extension has expired. A later invoice that fails starts a window of its
 * own that this grant does not cover. Nothing reaches Stripe, whose retries
 * carry on as before, so Stripe's own retry schedule must outlast the
 * extension or Stripe ends the subscription first.
 *
 * Once per invoice: running it again with the same days resumes the same
 * grant, journaling it again, and any other extension of that invoice is
 * refused.
 */
export async function extendDunning(
  deps: DunningExtensionDependencies,
  input: { invoiceId: string; days: number; now?: Date },
) {
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new Error("A dunning extension is a whole number of days, at least one.");
  }
  const now = input.now ?? new Date();
  const pastDue = await deps.dunning.findPastDueSubscription({ invoiceId: input.invoiceId });
  if (!pastDue) {
    throw new Error(
      `Invoice ${input.invoiceId} is not the failed renewal of a live Past Due subscription.`,
    );
  }
  const expiresAt = dunningExtensionExpiry(pastDue.pastDueSince, input.days);
  if (expiresAt <= now) {
    throw new Error(`An extension of ${input.days} days would already have expired.`);
  }

  const extension = await deps.dunning.grantDunningExtension({
    userId: pastDue.userId,
    invoiceId: input.invoiceId,
    expiresAt,
    grantedAt: now,
  });
  if (extension.expiresAt.getTime() !== expiresAt.getTime()) {
    throw new Error(
      `The dunning window of ${input.invoiceId} was already extended once, until ${extension.expiresAt.toISOString()}, by grant ${extension.id}.`,
    );
  }
  await deps.journal.write({
    kind: "grant",
    accountId: extension.userId,
    actionId: extension.id,
    at: extension.grantedAt,
  });
  return {
    grantId: extension.id,
    userId: extension.userId,
    invoiceId: extension.invoiceId,
    extendedUntil: extension.expiresAt,
  };
}

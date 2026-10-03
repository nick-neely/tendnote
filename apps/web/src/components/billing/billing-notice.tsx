import { getScheduledCancellation } from "@tendnote/db/queries/stripe-subscriptions";
import { Suspense } from "react";
import { admittedOwnerOrNull } from "@/lib/access/current-access";
import { formatBillingDate } from "@/lib/billing/billing-date";
import { ManageBillingButton } from "./manage-billing-button";

/**
 * The Ending notice (#609): a paying account that scheduled a cancellation is
 * still admitted, and sees when it ends on top of the working product, with the
 * way to change its mind. Read from Tendnote's own projection, never Stripe.
 * A failed read is no notice: it is advisory and must never break the shell.
 */
export async function EndingNoticeBanner() {
  const ownerUserId = await admittedOwnerOrNull();
  if (!ownerUserId) return null;
  const endsAt = await getScheduledCancellation({ userId: ownerUserId }).catch(() => null);
  if (!endsAt) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/10 px-4 py-2 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-foreground sm:px-6"
      role="status"
    >
      <span>
        <span className="font-medium">Your subscription ends on {formatBillingDate(endsAt)}.</span>{" "}
        You keep full access until then.
      </span>
      <ManageBillingButton variant="link" />
    </div>
  );
}

/** The billing notices behind their own boundary, so the read never holds the shell. */
export function BillingNotice() {
  return (
    <Suspense fallback={null}>
      <EndingNoticeBanner />
    </Suspense>
  );
}

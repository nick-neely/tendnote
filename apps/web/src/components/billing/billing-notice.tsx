import { getBillingStanding } from "@tendnote/db/queries/stripe-subscriptions";
import { Suspense } from "react";
import { admittedOwnerOrNull } from "@/lib/access/current-access";
import { formatBillingDate } from "@/lib/billing/billing-date";
import { pastDueNotice } from "@/lib/billing/past-due";
import { ManageBillingButton } from "./manage-billing-button";

/**
 * The Past Due (#610) and Ending (#609) notices: a paying account whose renewal
 * failed, or that scheduled a cancellation, is still admitted, and sees how
 * long on top of the working product, with the way into the portal to fix it.
 * Past Due comes first when both hold, because it ends sooner and the card is
 * what to fix. Read from Tendnote's own projection, never Stripe. A failed read
 * is no notice: it is advisory and must never break the shell.
 */
export async function BillingNoticeBanner() {
  const ownerUserId = await admittedOwnerOrNull();
  if (!ownerUserId) return null;
  const standing = await getBillingStanding({ userId: ownerUserId }).catch(() => null);
  const notice = standing?.pastDueSince
    ? pastDueNotice(standing.pastDueSince, new Date())
    : standing?.endsAt
      ? {
          headline: `Your subscription ends on ${formatBillingDate(standing.endsAt)}.`,
          detail: "You keep full access until then.",
        }
      : null;
  if (!notice) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/10 px-4 py-2 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-foreground sm:px-6"
      role="status"
    >
      <span>
        <span className="font-medium">{notice.headline}</span> {notice.detail}
      </span>
      <ManageBillingButton variant="link" />
    </div>
  );
}

/** The billing notices behind their own boundary, so the read never holds the shell. */
export function BillingNotice() {
  return (
    <Suspense fallback={null}>
      <BillingNoticeBanner />
    </Suspense>
  );
}

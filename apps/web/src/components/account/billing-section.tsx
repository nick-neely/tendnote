import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { formatBillingDate } from "@/lib/billing/billing-date";
import { pastDueNotice } from "@/lib/billing/past-due";

/**
 * Billing on the account page (#609): whether the subscription renews, ends, or
 * is Past Due (#610), and the way into the Stripe portal to change that, the
 * card, or the interval. Past Due comes first, as it does in the notice.
 */
export function BillingSection({
  endsAt,
  pastDueUntil,
}: {
  endsAt: Date | null;
  pastDueUntil: Date | null;
}) {
  const pastDue = pastDueUntil ? pastDueNotice(pastDueUntil, new Date()) : null;
  return (
    <section aria-labelledby="billing-heading" className="flex flex-col gap-3">
      <h2
        id="billing-heading"
        className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
      >
        Billing
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface px-3.5 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium">
            Subscription
          </span>
          <span className="text-[length:var(--text-small)] text-muted-foreground">
            {pastDue
              ? `${pastDue.headline} ${pastDue.detail}`
              : endsAt
                ? `Ends on ${formatBillingDate(endsAt)}. You keep full access until then.`
                : "Renews automatically. Update your card, switch between monthly and annual, or cancel."}
          </span>
        </div>
        <ManageBillingButton />
      </div>
    </section>
  );
}

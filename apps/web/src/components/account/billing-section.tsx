import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { formatBillingDate } from "@/lib/billing/billing-date";

/**
 * Billing on the account page (#609): whether the subscription renews or ends,
 * and the way into the Stripe portal to change that, the card, or the interval.
 */
export function BillingSection({ endsAt }: { endsAt: Date | null }) {
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
            {endsAt
              ? `Ends on ${formatBillingDate(endsAt)}. You keep full access until then.`
              : "Renews automatically. Update your card, switch between monthly and annual, or cancel."}
          </span>
        </div>
        <ManageBillingButton />
      </div>
    </section>
  );
}

import type Stripe from "stripe";
import { stripeId } from "./first-paid-invoice";

export type AnnualRenewal = {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  /** When the renewal is due: the start of the year it pays for. */
  renewsAt: Date;
};

/** The shortest calendar year, in seconds. No monthly period comes near it. */
const SHORTEST_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * The annual renewal an upcoming invoice announces, or `null` when it renews
 * monthly or belongs to no subscription (#611). Read from the invoice, which is
 * Stripe's preview of the charge itself, rather than from the subscription: an
 * annual subscriber who switched to monthly keeps a yearly item until the paid
 * year ends, but their upcoming invoice already bills a month.
 */
export function annualRenewal(invoice: Stripe.Invoice): AnnualRenewal | null {
  const stripeSubscriptionId = stripeId(invoice.parent?.subscription_details?.subscription ?? null);
  const stripeCustomerId = stripeId(invoice.customer);
  if (!stripeSubscriptionId || !stripeCustomerId) return null;
  const year = invoice.lines.data.find(
    (line) =>
      line.parent?.type === "subscription_item_details" &&
      line.period.end - line.period.start >= SHORTEST_YEAR_SECONDS,
  );
  if (!year) return null;
  return {
    stripeCustomerId,
    stripeSubscriptionId,
    renewsAt: new Date(year.period.start * 1000),
  };
}

import type Stripe from "stripe";

export type FirstPaidInvoice = {
  invoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  startedAt: Date;
};

/** The id of a Stripe reference, whether or not it was expanded. */
export function stripeId(value: string | { id: string } | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The invoice, Stripe customer, and subscription whose account an invoice
 * admits, and when the subscription started, or `null` when it is not
 * admission evidence. Only the paid first invoice of a subscription is (ADR
 * 0245): an `active` subscription whose invoice is unpaid, a later renewal, and
 * a paid invoice outside any subscription all admit nobody.
 *
 * The webhook and the reconciliation job both project through this one rule,
 * and both admit through `admitFromFirstPaidInvoice`, which refuses a
 * subscription that has since ended (#609).
 *
 * A subscription's first invoice covers a single instant, its creation, so its
 * `period_start` is the moment the subscription started.
 */
export function firstPaidInvoice(invoice: Stripe.Invoice): FirstPaidInvoice | null {
  if (invoice.status !== "paid" || invoice.billing_reason !== "subscription_create") return null;
  const owner = invoiceSubscription(invoice);
  if (!owner || !invoice.id) return null;
  return { invoiceId: invoice.id, ...owner, startedAt: new Date(invoice.period_start * 1000) };
}

/** The subscription an invoice bills and the customer it bills, or `null` outside a subscription. */
export function invoiceSubscription(
  invoice: Stripe.Invoice,
): { stripeSubscriptionId: string; stripeCustomerId: string } | null {
  const stripeSubscriptionId = stripeId(invoice.parent?.subscription_details?.subscription ?? null);
  const stripeCustomerId = stripeId(invoice.customer);
  return stripeSubscriptionId && stripeCustomerId
    ? { stripeSubscriptionId, stripeCustomerId }
    : null;
}

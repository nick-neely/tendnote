import type Stripe from "stripe";

export type FirstPaidInvoice = { invoiceId: string; stripeCustomerId: string; startedAt: Date };

function stripeId(value: string | { id: string } | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The invoice and Stripe customer whose account an invoice admits, and when its
 * subscription started, or `null` when it is not admission evidence. Only the
 * paid first invoice of a subscription is (ADR 0245): an `active` subscription
 * whose invoice is unpaid, a later renewal, and a paid invoice outside any
 * subscription all admit nobody.
 *
 * The webhook and the reconciliation job both project through this one rule.
 * Nothing revokes Paid Access yet; whatever first does must stop both of them
 * re-admitting from a first invoice that is still paid in Stripe.
 *
 * A subscription's first invoice covers a single instant, its creation, so its
 * `period_start` is the moment the subscription started.
 */
export function firstPaidInvoice(invoice: Stripe.Invoice): FirstPaidInvoice | null {
  if (invoice.status !== "paid" || invoice.billing_reason !== "subscription_create") return null;
  if (!invoice.parent?.subscription_details || !invoice.id) return null;
  const stripeCustomerId = stripeId(invoice.customer);
  if (!stripeCustomerId) return null;
  return {
    invoiceId: invoice.id,
    stripeCustomerId,
    startedAt: new Date(invoice.period_start * 1000),
  };
}

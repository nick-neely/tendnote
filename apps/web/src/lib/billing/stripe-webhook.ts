import type { AdmissionPolicy } from "@tendnote/domain";
import Stripe from "stripe";

export type StripeWebhookDependencies = {
  policy: AdmissionPolicy;
  /** The endpoint's signing secret. Without it every delivery is refused. */
  webhookSecret: string | undefined;
  /** The account a Tendnote-created Stripe customer belongs to, read locally. */
  findAccountByStripeCustomer: (stripeCustomerId: string) => Promise<string | null>;
  /** Grant the account the Paid Access source. Must be idempotent. */
  grantPaidAccess: (userId: string) => Promise<unknown>;
  /** Anchor the account's Usage Period to its subscription's start. Must be idempotent. */
  anchorUsagePeriod: (userId: string, startedAt: Date) => Promise<unknown>;
  /**
   * Send the content-free "you're in" email once admission is recorded (#607).
   * Called again on a redelivery, so it must key the send on the invoice.
   */
  announceAdmission: (input: { userId: string; invoiceId: string }) => Promise<unknown>;
  log?: (message: string) => void;
};

function stripeId(value: string | { id: string } | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The invoice and Stripe customer whose account an event admits, and when its
 * subscription started, or `null` when the event is not admission evidence.
 * Only the paid first invoice of a subscription is (ADR 0245): a Checkout
 * redirect, a completed session, an `active` subscription whose invoice is
 * unpaid, a created customer, and a later renewal all admit nobody.
 *
 * A subscription's first invoice covers a single instant, its creation, so its
 * `period_start` is the moment the subscription started.
 */
function firstPaidInvoice(
  event: Stripe.Event,
): { invoiceId: string; stripeCustomerId: string; startedAt: Date } | null {
  if (event.type !== "invoice.paid") return null;
  const invoice = event.data.object;
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

/**
 * The Stripe webhook receiver (#606). It verifies the signature over the raw
 * body before reading anything, then projects the first paid invoice onto Paid
 * Access and the account's Usage Period anchor (#625). Both writes are
 * idempotent, so a duplicate delivery is a no-op, and the customer was
 * recorded before Checkout opened, so an invoice can always be matched to its
 * account without any earlier event having arrived. Once admission is recorded
 * the "you're in" email follows, never before it (#607). Nothing revokes Paid
 * Access yet; whatever first
 * does must also stop a redelivered first invoice from re-admitting.
 *
 * A failure after verification surfaces as a 500 so Stripe redelivers;
 * accepting the HTTP delivery is not treated as completion. Self-hosted
 * deployments answer 404 and run none of this.
 */
export function createStripeWebhookHandler(deps: StripeWebhookDependencies) {
  const log = deps.log ?? ((message: string) => console.warn(message));

  return async function handleStripeWebhook(request: Request): Promise<Response> {
    if (deps.policy.mode !== "hosted") {
      return new Response(null, { status: 404 });
    }
    if (!deps.webhookSecret) {
      return new Response("Stripe webhooks are not configured.", { status: 503 });
    }

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return new Response("Missing Stripe signature.", { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = await Stripe.webhooks.constructEventAsync(
        await request.text(),
        signature,
        deps.webhookSecret,
      );
    } catch {
      return new Response("Invalid Stripe signature.", { status: 400 });
    }

    const paid = firstPaidInvoice(event);
    if (!paid) {
      return new Response(null, { status: 200 });
    }

    const userId = await deps.findAccountByStripeCustomer(paid.stripeCustomerId);
    if (!userId) {
      // Not a customer Tendnote created for an account, so there is no one to
      // admit. Acknowledge it rather than have Stripe retry for days.
      log(`[tendnote] Stripe event ${event.id} names an unknown customer; nothing was admitted`);
      return new Response(null, { status: 200 });
    }

    await deps.grantPaidAccess(userId);
    // After the grant, which is what guarantees the Access Profile exists.
    await deps.anchorUsagePeriod(userId, paid.startedAt);
    // Last, once admission is fully recorded. A failed send surfaces as a 500
    // like any other failure, so Stripe's redelivery retries it; both writes
    // above are idempotent.
    await deps.announceAdmission({ userId, invoiceId: paid.invoiceId });
    return new Response(null, { status: 200 });
  };
}

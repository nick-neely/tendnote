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
  log?: (message: string) => void;
};

function stripeId(value: string | { id: string } | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The Stripe customer whose account an event admits, or `null` when the event
 * is not admission evidence. Only a paid subscription invoice is (ADR 0245): a
 * Checkout redirect, a completed session, an `active` subscription whose invoice
 * is unpaid, and a created customer all admit nobody.
 */
function paidInvoiceCustomer(event: Stripe.Event): string | null {
  if (event.type !== "invoice.paid") return null;
  const invoice = event.data.object;
  if (invoice.status !== "paid" || !invoice.parent?.subscription_details) return null;
  return stripeId(invoice.customer);
}

/**
 * The Stripe webhook receiver (#606). It verifies the signature over the raw
 * body before reading anything, then projects the first paid invoice onto Paid
 * Access. The projection only ever grants the one idempotent source, so a
 * duplicate delivery is a no-op and delivery order never matters: the customer
 * was recorded before Checkout opened, so an invoice can always be matched to
 * its account without any earlier event having arrived.
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

    const stripeCustomerId = paidInvoiceCustomer(event);
    if (!stripeCustomerId) {
      return new Response(null, { status: 200 });
    }

    const userId = await deps.findAccountByStripeCustomer(stripeCustomerId);
    if (!userId) {
      // Not a customer Tendnote created for an account, so there is no one to
      // admit. Acknowledge it rather than have Stripe retry for days.
      log(`[tendnote] Stripe event ${event.id} names an unknown customer; nothing was admitted`);
      return new Response(null, { status: 200 });
    }

    await deps.grantPaidAccess(userId);
    return new Response(null, { status: 200 });
  };
}

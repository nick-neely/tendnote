import type { AdmissionPolicy } from "@tendnote/domain";
import Stripe from "stripe";
import {
  projectSubscription,
  type SubscriptionProjectionDependencies,
  type SubscriptionSnapshot,
} from "./subscription-projection";

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
  /**
   * Stripe's current copy of a subscription. The receiver projects that rather
   * than the event's own copy, so the order events arrive in cannot matter.
   */
  retrieveSubscription: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  /** Where subscription state lands on the account (#609). */
  subscriptions: SubscriptionProjectionDependencies;
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
function firstPaidInvoice(event: Stripe.Event): {
  invoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  startedAt: Date;
} | null {
  if (event.type !== "invoice.paid") return null;
  const invoice = event.data.object;
  if (invoice.status !== "paid" || invoice.billing_reason !== "subscription_create") return null;
  const subscription = invoice.parent?.subscription_details?.subscription ?? null;
  const stripeSubscriptionId = stripeId(subscription);
  if (!stripeSubscriptionId || !invoice.id) return null;
  const stripeCustomerId = stripeId(invoice.customer);
  if (!stripeCustomerId) return null;
  return {
    invoiceId: invoice.id,
    stripeCustomerId,
    stripeSubscriptionId,
    startedAt: new Date(invoice.period_start * 1000),
  };
}

/** The subscription a portal change or a period end touched, if this event is one. */
function changedSubscriptionId(event: Stripe.Event): string | null {
  return event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
    ? event.data.object.id
    : null;
}

/**
 * The Stripe webhook receiver (#606). It verifies the signature over the raw
 * body before reading anything, then projects the first paid invoice onto Paid
 * Access and the account's Usage Period anchor (#625). Both writes are
 * idempotent, so a duplicate delivery is a no-op, and the customer was
 * recorded before Checkout opened, so an invoice can always be matched to its
 * account without any earlier event having arrived. Once admission is recorded
 * the "you're in" email follows, never before it (#607).
 *
 * Subscription changes from the portal and period ends are projected from
 * Stripe's current copy of the subscription (#609): a scheduled cancellation is
 * recorded for the Ending notice and confirmed by email, and an ended
 * subscription makes the account Lapsed. The first paid invoice is projected
 * the same way before it admits, so a redelivered first invoice of a
 * subscription that has since ended re-admits nobody.
 *
 * A failure after verification surfaces as a 500 so Stripe redelivers;
 * accepting the HTTP delivery is not treated as completion. Self-hosted
 * deployments answer 404 and run none of this.
 */
export function createStripeWebhookHandler(deps: StripeWebhookDependencies) {
  const log = deps.log ?? ((message: string) => console.warn(message));

  /**
   * The account a Stripe customer belongs to. A customer Tendnote never created
   * has no account to change, so the event is acknowledged rather than left for
   * Stripe to retry for days.
   */
  async function accountFor(stripeCustomerId: string, eventId: string) {
    const userId = await deps.findAccountByStripeCustomer(stripeCustomerId);
    if (!userId) {
      log(`[tendnote] Stripe event ${eventId} names an unknown customer; nothing was changed`);
    }
    return userId;
  }

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

    const changed = changedSubscriptionId(event);
    if (changed) {
      const subscription = await deps.retrieveSubscription(changed);
      const userId = await accountFor(subscription.stripeCustomerId, event.id);
      if (userId) await projectSubscription(deps.subscriptions, userId, subscription);
      return new Response(null, { status: 200 });
    }

    const paid = firstPaidInvoice(event);
    if (!paid) {
      return new Response(null, { status: 200 });
    }

    const userId = await accountFor(paid.stripeCustomerId, event.id);
    if (!userId) {
      return new Response(null, { status: 200 });
    }

    const subscription = await deps.retrieveSubscription(paid.stripeSubscriptionId);
    await projectSubscription(deps.subscriptions, userId, subscription);
    if (subscription.endedAt) {
      log(
        `[tendnote] Stripe event ${event.id} pays a subscription that has ended; nothing was admitted`,
      );
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

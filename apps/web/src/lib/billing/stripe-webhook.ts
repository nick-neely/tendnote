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
  /** Grant the account Paid Access from this subscription. Must be idempotent. */
  grantPaidAccess: (userId: string, stripeSubscriptionId: string) => Promise<unknown>;
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

type FirstPaidInvoice = NonNullable<ReturnType<typeof firstPaidInvoice>>;

/**
 * Admit an account on its subscription's first paid invoice: the one way Paid
 * Access is granted, for the webhook and for any later re-projection such as
 * reconciliation (#608). The subscription is projected from Stripe's current
 * copy first, and one that has ended admits nobody, so re-projecting a still-
 * paid first invoice can never bring back an account its end made Lapsed.
 *
 * Every write is idempotent. The "you're in" email goes last, once admission is
 * fully recorded; a failed send throws like any other failure, so the caller's
 * retry sends it again.
 */
export async function admitFirstPaidInvoice(
  deps: Pick<
    StripeWebhookDependencies,
    | "retrieveSubscription"
    | "subscriptions"
    | "grantPaidAccess"
    | "anchorUsagePeriod"
    | "announceAdmission"
  >,
  userId: string,
  paid: FirstPaidInvoice,
): Promise<"admitted" | "subscription_ended"> {
  const subscription = await deps.retrieveSubscription(paid.stripeSubscriptionId);
  await projectSubscription(deps.subscriptions, userId, subscription);
  if (subscription.endedAt) return "subscription_ended";

  await deps.grantPaidAccess(userId, paid.stripeSubscriptionId);
  // After the grant, which is what guarantees the Access Profile exists.
  await deps.anchorUsagePeriod(userId, paid.startedAt);
  await deps.announceAdmission({ userId, invoiceId: paid.invoiceId });
  return "admitted";
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

    if ((await admitFirstPaidInvoice(deps, userId, paid)) === "subscription_ended") {
      log(
        `[tendnote] Stripe event ${event.id} pays a subscription that has ended; nothing was admitted`,
      );
    }
    return new Response(null, { status: 200 });
  };
}

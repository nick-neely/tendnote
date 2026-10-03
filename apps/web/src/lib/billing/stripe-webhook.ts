import type { AdmissionPolicy } from "@tendnote/domain";
import Stripe from "stripe";
import { firstPaidInvoice } from "./first-paid-invoice";
import {
  admitFromFirstPaidInvoice,
  type PaidAccessAdmissionDependencies,
} from "./paid-access-admission";
import {
  applyStripeDispute,
  applyStripeRefund,
  disputeSnapshot,
  type PaidAccessRevocationDependencies,
  refundSnapshot,
} from "./paid-access-revocation";
import { projectSubscription } from "./subscription-projection";
import { type AnnualRenewal, annualRenewal } from "./upcoming-renewal";

export type StripeWebhookDependencies = PaidAccessAdmissionDependencies &
  PaidAccessRevocationDependencies & {
    policy: AdmissionPolicy;
    /** The endpoint's signing secret. Without it every delivery is refused. */
    webhookSecret: string | undefined;
    /** The account a Tendnote-created Stripe customer belongs to, read locally. */
    findAccountByStripeCustomer: (stripeCustomerId: string) => Promise<string | null>;
    /**
     * Send the content-free "you're in" email once admission is recorded (#607).
     * Called again on a redelivery, so it must key the send on the invoice.
     */
    announceAdmission: (input: { userId: string; invoiceId: string }) => Promise<unknown>;
    /**
     * Send the content-free reminder before an annual renewal (#611). Called
     * again on a redelivery, so it must key the send on the renewal.
     */
    remindOfRenewal: (input: {
      userId: string;
      stripeSubscriptionId: string;
      renewsAt: Date;
    }) => Promise<unknown>;
    log?: (message: string) => void;
  };

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
 * the "you're in" email follows, never before it (#607). A dropped delivery is
 * repaired by the reconciliation job on the recovery cron (#608).
 *
 * Subscription changes from the portal and period ends are projected from
 * Stripe's current copy of the subscription (#609): a scheduled cancellation is
 * recorded for the Ending notice and confirmed by email, and an ended
 * subscription makes the account Lapsed. The first paid invoice is projected
 * the same way before it admits, so a redelivered first invoice of a
 * subscription that has since ended re-admits nobody.
 *
 * Stripe announces every renewal some days ahead with `invoice.upcoming`, as
 * many as the dashboard's Upcoming renewal events setting says (#611). An
 * annual renewal gets the reminder email, unless Stripe's current copy of the
 * subscription ends first; a monthly one gets nothing.
 *
 * A refund revokes Paid Access only when it matches a Refund Operator Action
 * record, on the subscription that record names; one matching nothing changes
 * nothing and is logged as `stripe_reconciliation.failed`, the record the
 * operator alert reads (ADR 0249). A dispute revokes at once unless a
 * re-admission grant names it (#617).
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

  /**
   * Remind the account of an annual renewal, unless Stripe's current copy of
   * the subscription ends first: a cancellation may postdate the announcement.
   * A failed send throws, so Stripe's redelivery retries it.
   */
  async function remindOfRenewal(renewal: AnnualRenewal, eventId: string) {
    const userId = await accountFor(renewal.stripeCustomerId, eventId);
    if (!userId) return;
    const subscription = await deps.retrieveSubscription(renewal.stripeSubscriptionId);
    const ends = subscription.endedAt ?? subscription.cancelAt;
    if (ends && ends <= renewal.renewsAt) return;
    await deps.remindOfRenewal({
      userId,
      stripeSubscriptionId: renewal.stripeSubscriptionId,
      renewsAt: renewal.renewsAt,
    });
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

    if (event.type === "refund.created") {
      const refund = refundSnapshot(event.data.object);
      if ((await applyStripeRefund(deps, refund)) === "unmatched") {
        log(
          `[tendnote] stripe_reconciliation.failed: refund ${refund.id} matches no Refund record; nothing was changed`,
        );
      }
      return new Response(null, { status: 200 });
    }

    if (event.type === "charge.dispute.created") {
      const outcome = await applyStripeDispute(deps, disputeSnapshot(event.data.object));
      if (outcome === "outside_subscription" || outcome === "unknown_customer") {
        log(
          `[tendnote] Stripe event ${event.id} disputes no Tendnote subscription; nothing was changed`,
        );
      }
      return new Response(null, { status: 200 });
    }

    const renewal = event.type === "invoice.upcoming" ? annualRenewal(event.data.object) : null;
    if (renewal) {
      await remindOfRenewal(renewal, event.id);
      return new Response(null, { status: 200 });
    }

    const changed = changedSubscriptionId(event);
    if (changed) {
      const subscription = await deps.retrieveSubscription(changed);
      const userId = await accountFor(subscription.stripeCustomerId, event.id);
      if (userId) await projectSubscription(deps.subscriptions, userId, subscription);
      return new Response(null, { status: 200 });
    }

    const paid = event.type === "invoice.paid" ? firstPaidInvoice(event.data.object) : null;
    if (!paid) {
      return new Response(null, { status: 200 });
    }

    const userId = await accountFor(paid.stripeCustomerId, event.id);
    if (!userId) {
      return new Response(null, { status: 200 });
    }

    if (!(await admitFromFirstPaidInvoice(deps, userId, paid))) {
      log(
        `[tendnote] Stripe event ${event.id} pays a subscription that has ended or was revoked; nothing was admitted`,
      );
      return new Response(null, { status: 200 });
    }
    // Last, once admission is fully recorded. A failed send surfaces as a 500
    // like any other failure, so Stripe's redelivery retries it; every write
    // before it is idempotent.
    await deps.announceAdmission({ userId, invoiceId: paid.invoiceId });
    return new Response(null, { status: 200 });
  };
}

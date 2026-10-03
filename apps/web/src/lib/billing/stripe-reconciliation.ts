import type { ClosedDunningWindow } from "@tendnote/db/queries/stripe-subscriptions";
import {
  type AccessProfile,
  type AdmissionPolicy,
  dunningWindowEnd,
  dunningWindowsClosedBy,
} from "@tendnote/domain";
import type Stripe from "stripe";
import { firstPaidInvoice } from "./first-paid-invoice";
import {
  admitFromFirstPaidInvoice,
  type PaidAccessAdmissionDependencies,
} from "./paid-access-admission";
import { projectSubscription, type SubscriptionSnapshot } from "./subscription-projection";

/**
 * How far back each pass reads Stripe's paid invoices and subscription events.
 * Stripe keeps events for exactly this long. It covers Stripe's
 * three-day webhook retry schedule, a restore from anywhere in the seven-day
 * Backup Window (ADR 0250), and a cron outage of weeks on top. A first invoice
 * is paid when Checkout completes, so one older than this was either projected
 * long ago or belongs to an account the operator already knows about.
 */
export const RECONCILIATION_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** The slice of the Stripe client reconciliation reads. Listing pages lazily. */
export type ReconciliationStripeClient = {
  invoices: { list: (params: Stripe.InvoiceListParams) => AsyncIterable<Stripe.Invoice> };
  events: { list: (params: Stripe.EventListParams) => AsyncIterable<Stripe.Event> };
};

/** The subscription changes the webhook projects, replayed here when a delivery was lost. */
const SUBSCRIPTION_EVENT_TYPES = ["customer.subscription.updated", "customer.subscription.deleted"];

type ProfileStanding = Pick<AccessProfile, "status" | "source">;

export type StripeReconciliationDependencies = PaidAccessAdmissionDependencies & {
  policy: AdmissionPolicy;
  /** `null` when Stripe is not configured, which also means nobody could have paid. */
  stripe: ReconciliationStripeClient | null;
  findAccountByStripeCustomer: (stripeCustomerId: string) => Promise<string | null>;
  readAccessProfile: (userId: string) => Promise<ProfileStanding | null>;
  /** Live subscriptions recorded Past Due since at or before `pastDueAtOrBefore` (#610). */
  listClosedDunningWindows: (input: { pastDueAtOrBefore: Date }) => Promise<ClosedDunningWindow[]>;
  /** End a subscription in Stripe at once, returning Stripe's copy of the ended subscription. */
  cancelSubscription: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  /**
   * The "you're in" email (#607), sent only when this pass is what admitted the
   * account. Keyed on the invoice, as for the webhook, so a pass racing a late
   * delivery still sends one message.
   */
  announceAdmission: (input: { userId: string; invoiceId: string }) => Promise<unknown>;
  logger?: {
    warn?: (message: string, context?: Record<string, unknown>) => void;
    error?: (message: string, context?: Record<string, unknown>) => void;
  };
};

type StripeReconciliationResult =
  | { status: "skipped" }
  | {
      status: "ran";
      scanned: number;
      admitted: number;
      /** Subscriptions this pass ended because their dunning window closed (#610). */
      dunningClosed: number;
      unknownCustomer: number;
      failed: number;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Stripe reconciliation job (#608). On the background recovery cron it
 * recomputes the Paid Access projection from Stripe's current paid invoices
 * through the same first-paid-invoice rule as the webhook, and re-projects every
 * subscription changed inside the window (#609), so a delivery that was
 * dropped or failed for good is repaired on the next pass. It also closes every
 * dunning window that has run its seven days (#610).
 *
 * It is idempotent: an account already standing where the invoice would put it
 * is left as it is and is sent no second email. It only ever adds the Paid
 * Access source through the grant, which keeps an operator's grant as recorded,
 * and it never reads or writes admission blocks, so an operator's block stays
 * in force over a projected grant (ADR 0248).
 *
 * A failure never throws into the rest of the cron pass. Each one is logged as
 * `stripe_reconciliation.failed`, the record the operator alert channel reads,
 * and the next pass retries a failed read or grant. Self-hosted deployments run
 * none of this.
 */
export function createStripeReconciliation(deps: StripeReconciliationDependencies) {
  async function project(
    invoice: Stripe.Invoice,
    result: Extract<StripeReconciliationResult, { status: "ran" }>,
  ) {
    const paid = firstPaidInvoice(invoice);
    if (!paid) return;

    let userId: string | null = null;
    try {
      userId = await deps.findAccountByStripeCustomer(paid.stripeCustomerId);
      if (!userId) {
        // Not a customer Tendnote created for an account, or one whose account
        // has since been deleted, so there is no one to admit.
        result.unknownCustomer += 1;
        deps.logger?.warn?.("stripe_reconciliation.unknown_customer", {
          invoiceId: paid.invoiceId,
        });
        return;
      }

      const before = await deps.readAccessProfile(userId);
      // A subscription that has since ended admits nobody, so an account its
      // end made Lapsed stays Lapsed however long its first invoice stays paid.
      const after = await admitFromFirstPaidInvoice(deps, userId, paid);
      if (!after) return;
      if (before?.status === "granted" && before.source === after.source) return;
      result.admitted += 1;
    } catch (error) {
      result.failed += 1;
      deps.logger?.error?.("stripe_reconciliation.failed", {
        stage: "project",
        invoiceId: paid.invoiceId,
        ...(userId ? { userId } : {}),
        error: errorMessage(error),
      });
      return;
    }

    // The webhook would have sent this; it never got the chance. A failed send
    // is not retried, since the next pass finds the account already admitted;
    // the completed-email fence (#620) is what makes it exact-once.
    try {
      await deps.announceAdmission({ userId, invoiceId: paid.invoiceId });
    } catch (error) {
      result.failed += 1;
      deps.logger?.error?.("stripe_reconciliation.failed", {
        stage: "announce",
        invoiceId: paid.invoiceId,
        userId,
        error: errorMessage(error),
      });
    }
  }

  /**
   * Re-project one subscription from Stripe's current copy, exactly as the
   * webhook does, so a lost end makes the account Lapsed and a lost scheduled
   * cancellation shows its Ending notice and is confirmed (#609).
   */
  async function reprojectSubscription(
    stripeSubscriptionId: string,
    result: Extract<StripeReconciliationResult, { status: "ran" }>,
  ) {
    try {
      const subscription = await deps.retrieveSubscription(stripeSubscriptionId);
      const userId = await deps.findAccountByStripeCustomer(subscription.stripeCustomerId);
      if (!userId) {
        result.unknownCustomer += 1;
        deps.logger?.warn?.("stripe_reconciliation.unknown_customer", { stripeSubscriptionId });
        return;
      }
      await projectSubscription(deps.subscriptions, userId, subscription);
    } catch (error) {
      result.failed += 1;
      deps.logger?.error?.("stripe_reconciliation.failed", {
        stage: "subscription",
        stripeSubscriptionId,
        error: errorMessage(error),
      });
    }
  }

  /**
   * Every subscription changed inside the window, once each. The first-invoice
   * pass already re-reads young subscriptions; this reaches the ones whose first
   * invoice is older than the window, which is where a lost end would otherwise
   * leave a cancelled account admitted for good.
   */
  async function reconcileSubscriptions(
    stripe: ReconciliationStripeClient,
    since: number,
    result: Extract<StripeReconciliationResult, { status: "ran" }>,
  ) {
    const changed = new Set<string>();
    try {
      const events = stripe.events.list({
        types: SUBSCRIPTION_EVENT_TYPES,
        created: { gte: since },
        limit: 100,
      });
      for await (const event of events) {
        const object = event.data.object as { object?: string; id?: string };
        if (object.object === "subscription" && object.id) changed.add(object.id);
      }
    } catch (error) {
      result.failed += 1;
      deps.logger?.error?.("stripe_reconciliation.failed", {
        stage: "events",
        error: errorMessage(error),
      });
    }
    for (const stripeSubscriptionId of changed) {
      await reprojectSubscription(stripeSubscriptionId, result);
    }
  }

  /**
   * End one subscription whose dunning window has closed (#610). Stripe's
   * current copy decides, not the record: a payment that recovered after it was
   * recorded, or a later failure whose own window is still open, is projected as
   * it stands and nothing is ended. Otherwise the subscription is cancelled in
   * Stripe, which stops its retries, so a Lapsed account is never charged for
   * the invoice and can resubscribe, and the ended copy is projected like any
   * other end, which makes the account Lapsed.
   */
  async function closeDunningWindow(
    window: ClosedDunningWindow,
    now: Date,
    result: Extract<StripeReconciliationResult, { status: "ran" }>,
  ) {
    try {
      const current = await deps.retrieveSubscription(window.stripeSubscriptionId);
      const closed =
        !current.endedAt && current.pastDue && dunningWindowEnd(current.pastDue.since) <= now;
      const subscription = closed
        ? await deps.cancelSubscription(window.stripeSubscriptionId)
        : current;
      await projectSubscription(deps.subscriptions, window.userId, subscription);
      if (closed) result.dunningClosed += 1;
    } catch (error) {
      result.failed += 1;
      deps.logger?.error?.("stripe_reconciliation.failed", {
        stage: "dunning",
        stripeSubscriptionId: window.stripeSubscriptionId,
        invoiceId: window.invoiceId,
        userId: window.userId,
        error: errorMessage(error),
      });
    }
  }

  /**
   * Every live subscription Past Due for the whole dunning window, read from
   * Tendnote's own record. The window is Tendnote's policy rather than Stripe's
   * retry schedule, so it closes here and not on any Stripe event.
   */
  async function closeDunningWindows(
    now: Date,
    result: Extract<StripeReconciliationResult, { status: "ran" }>,
  ) {
    let closed: ClosedDunningWindow[];
    try {
      closed = await deps.listClosedDunningWindows({
        pastDueAtOrBefore: dunningWindowsClosedBy(now),
      });
    } catch (error) {
      result.failed += 1;
      deps.logger?.error?.("stripe_reconciliation.failed", {
        stage: "dunning",
        error: errorMessage(error),
      });
      return;
    }
    for (const window of closed) await closeDunningWindow(window, now, result);
  }

  return async function reconcile(input: { now?: Date } = {}): Promise<StripeReconciliationResult> {
    if (deps.policy.mode !== "hosted" || !deps.stripe) return { status: "skipped" };

    const now = input.now ?? new Date();
    const result = {
      status: "ran" as const,
      scanned: 0,
      admitted: 0,
      dunningClosed: 0,
      unknownCustomer: 0,
      failed: 0,
    };
    const since = Math.floor((now.getTime() - RECONCILIATION_LOOKBACK_MS) / 1000);
    try {
      const invoices = deps.stripe.invoices.list({
        status: "paid",
        created: { gte: since },
        limit: 100,
      });
      for await (const invoice of invoices) {
        result.scanned += 1;
        await project(invoice, result);
      }
    } catch (error) {
      result.failed += 1;
      deps.logger?.error?.("stripe_reconciliation.failed", {
        stage: "list",
        error: errorMessage(error),
      });
    }
    await reconcileSubscriptions(deps.stripe, since, result);
    // After the replay, so a recovery whose webhook was lost is on record first.
    await closeDunningWindows(now, result);
    return result;
  };
}

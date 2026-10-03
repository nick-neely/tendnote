import type { AccessProfile, AdmissionPolicy } from "@tendnote/domain";
import type Stripe from "stripe";
import { firstPaidInvoice } from "./first-paid-invoice";
import {
  admitFromFirstPaidInvoice,
  type PaidAccessAdmissionDependencies,
} from "./paid-access-admission";

/**
 * How far back each pass reads Stripe's paid invoices. It covers Stripe's
 * three-day webhook retry schedule, a restore from anywhere in the seven-day
 * Backup Window (ADR 0250), and a cron outage of weeks on top. A first invoice
 * is paid when Checkout completes, so one older than this was either projected
 * long ago or belongs to an account the operator already knows about.
 */
export const RECONCILIATION_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** The slice of the Stripe client reconciliation reads. Listing pages lazily. */
export type ReconciliationStripeClient = {
  invoices: { list: (params: Stripe.InvoiceListParams) => AsyncIterable<Stripe.Invoice> };
};

type ProfileStanding = Pick<AccessProfile, "status" | "source">;

export type StripeReconciliationDependencies = PaidAccessAdmissionDependencies & {
  policy: AdmissionPolicy;
  /** `null` when Stripe is not configured, which also means nobody could have paid. */
  stripe: ReconciliationStripeClient | null;
  findAccountByStripeCustomer: (stripeCustomerId: string) => Promise<string | null>;
  readAccessProfile: (userId: string) => Promise<ProfileStanding | null>;
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
  | { status: "ran"; scanned: number; admitted: number; unknownCustomer: number; failed: number };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Stripe reconciliation job (#608). On the background recovery cron it
 * recomputes the Paid Access projection from Stripe's current paid invoices
 * through the same first-paid-invoice rule as the webhook, so a delivery that
 * was dropped or failed for good is repaired on the next pass.
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

  return async function reconcile(input: { now?: Date } = {}): Promise<StripeReconciliationResult> {
    if (deps.policy.mode !== "hosted" || !deps.stripe) return { status: "skipped" };

    const now = input.now ?? new Date();
    const result = {
      status: "ran" as const,
      scanned: 0,
      admitted: 0,
      unknownCustomer: 0,
      failed: 0,
    };
    try {
      const invoices = deps.stripe.invoices.list({
        status: "paid",
        created: { gte: Math.floor((now.getTime() - RECONCILIATION_LOOKBACK_MS) / 1000) },
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
    return result;
  };
}

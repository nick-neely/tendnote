import type Stripe from "stripe";

/** The one Tendnote plan's two billing intervals. */
const BILLING_INTERVALS = ["monthly", "annual"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function parseBillingInterval(value: unknown): BillingInterval | null {
  return BILLING_INTERVALS.find((interval) => interval === value) ?? null;
}

export type StripeBillingConfig = {
  secretKey: string;
  prices: Record<BillingInterval, string>;
};

/**
 * The Stripe settings Checkout needs, or `null` when any is missing. A
 * deployment without them, including every self-hosted one, offers no Checkout.
 */
export function readStripeBillingConfig(
  env: Record<string, string | undefined> = process.env,
): StripeBillingConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  const monthly = env.STRIPE_PRICE_MONTHLY;
  const annual = env.STRIPE_PRICE_ANNUAL;
  if (!secretKey || !monthly || !annual) return null;
  return { secretKey, prices: { monthly, annual } };
}

/** The slice of the Stripe client Checkout uses. */
export type CheckoutStripeClient = {
  customers: {
    create: (
      params: Stripe.CustomerCreateParams,
      options: Stripe.RequestOptions,
    ) => Promise<{ id: string }>;
  };
  subscriptions: {
    list: (
      params: Stripe.SubscriptionListParams,
    ) => Promise<{ data: ReadonlyArray<{ id: string; status: Stripe.Subscription.Status }> }>;
    cancel: (id: string) => Promise<unknown>;
  };
  checkout: {
    sessions: {
      create: (params: Stripe.Checkout.SessionCreateParams) => Promise<{ url: string | null }>;
    };
  };
};

export type CheckoutDependencies = {
  stripe: CheckoutStripeClient;
  prices: Record<BillingInterval, string>;
  /** The app origin Checkout returns to. */
  baseUrl: string;
  getStripeCustomerId: (input: { userId: string }) => Promise<string | null>;
  recordStripeCustomer: (input: { userId: string; stripeCustomerId: string }) => Promise<string>;
};

/**
 * The account's one Stripe customer, created on the first Subscribe and reused
 * by every later attempt. The idempotency key collapses a double submit into one
 * customer even before the local record exists, and the customer is recorded
 * before Checkout opens so the webhook can always match its invoice.
 */
async function ensureStripeCustomer(
  deps: CheckoutDependencies,
  account: { userId: string; email: string },
): Promise<string> {
  const existing = await deps.getStripeCustomerId({ userId: account.userId });
  if (existing) return existing;

  const customer = await deps.stripe.customers.create(
    { email: account.email, metadata: { tendnote_user_id: account.userId } },
    { idempotencyKey: `tendnote-customer-${account.userId}` },
  );
  return deps.recordStripeCustomer({ userId: account.userId, stripeCustomerId: customer.id });
}

/**
 * Subscription states that mean the account has already paid or is paying.
 * `incomplete` is left out: a card challenge abandoned inside Checkout must not
 * lock the account out of trying again for the day Stripe keeps it open.
 */
const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

/**
 * Settle the customer's earlier subscriptions before a new Checkout: `live` when
 * one is already paid or paying. Otherwise every abandoned `incomplete` one is
 * cancelled, so an old attempt can never be
 * paid later beside the new one. It has charged nothing, so cancelling it only
 * voids its unpaid invoice.
 */
async function settlePriorSubscriptions(
  stripe: CheckoutStripeClient,
  customer: string,
): Promise<"live" | "clear"> {
  const { data } = await stripe.subscriptions.list({ customer, status: "all", limit: 10 });
  if (data.some((subscription) => LIVE_SUBSCRIPTION_STATUSES.has(subscription.status))) {
    return "live";
  }

  for (const subscription of data) {
    if (subscription.status === "incomplete") await stripe.subscriptions.cancel(subscription.id);
  }
  return "clear";
}

/**
 * Open Stripe Checkout for one account and return the URL to send it to (#606).
 * Cards only, so payment evidence is synchronous; the account as the client
 * reference; Stripe Tax on the tax-exclusive price. Returning from Checkout
 * admits nobody: the confirming page waits for the paid invoice to be projected.
 *
 * One account holds one subscription, so an account that has already paid but
 * is not yet admitted, because its invoice is still on the way, is sent back to
 * the confirming page instead of into a second Checkout.
 */
export async function openCheckout(
  deps: CheckoutDependencies,
  input: { userId: string; email: string; interval: BillingInterval },
): Promise<string> {
  const customer = await ensureStripeCustomer(deps, input);
  if ((await settlePriorSubscriptions(deps.stripe, customer)) === "live") {
    return new URL("/confirming", deps.baseUrl).toString();
  }

  const session = await deps.stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: input.userId,
    line_items: [{ price: deps.prices[input.interval], quantity: 1 }],
    payment_method_types: ["card"],
    // The full billing address feeds Stripe Tax and the account's Radar rule
    // that refuses a non-US billing country before any charge.
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    automatic_tax: { enabled: true },
    success_url: new URL("/confirming", deps.baseUrl).toString(),
    cancel_url: new URL("/pending", deps.baseUrl).toString(),
  });

  if (!session.url) throw new Error("Stripe Checkout did not return a URL.");
  return session.url;
}

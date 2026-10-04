import type Stripe from "stripe";
import type { BillingInterval } from "./checkout";

/**
 * The version of {@link portalConfiguration} a Stripe portal configuration was
 * created from. Bump it with any change to the configuration, so the next
 * portal session creates the new one rather than reusing the old.
 */
export const PORTAL_CONFIGURATION_VERSION = "1";
const VERSION_KEY = "tendnote_portal_configuration";

/**
 * What the Stripe portal lets a customer do, as decided (#609): update their
 * card, cancel at period end with no remainder refund and reverse that before
 * it ends, switch monthly to annual at once (invoicing the difference), and
 * switch annual to monthly only at the end of the paid year. Address changes
 * stay out, so the US billing country taken at Checkout cannot be edited away.
 */
export function portalConfiguration(input: {
  product: string;
  prices: Record<BillingInterval, string>;
}): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: false },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        products: [{ product: input.product, prices: [input.prices.monthly, input.prices.annual] }],
        proration_behavior: "always_invoice",
        schedule_at_period_end: { conditions: [{ type: "shortening_interval" }] },
      },
    },
    metadata: { [VERSION_KEY]: PORTAL_CONFIGURATION_VERSION },
  };
}

/**
 * The version of {@link cancelOnlyPortalConfiguration}, kept apart from the
 * full portal's under the same metadata key. Bump it with any change.
 */
export const CANCEL_ONLY_PORTAL_CONFIGURATION_VERSION = "cancel-only-1";

/**
 * The portal a suspended account cancels through (#629): cancel at period end,
 * as anyone may, and nothing else. No plan switch can invoice it, and no card
 * or invoice page is reachable, whatever page of the session it lands on.
 */
export function cancelOnlyPortalConfiguration(): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    features: {
      payment_method_update: { enabled: false },
      invoice_history: { enabled: false },
      customer_update: { enabled: false },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_update: { enabled: false },
    },
    metadata: { [VERSION_KEY]: CANCEL_ONLY_PORTAL_CONFIGURATION_VERSION },
  };
}

/** The slice of the Stripe client the portal uses. */
export type PortalStripeClient = {
  prices: { retrieve: (id: string) => Promise<{ product: string | { id: string } }> };
  billingPortal: {
    configurations: {
      list: (
        params: Stripe.BillingPortal.ConfigurationListParams,
      ) => Promise<{ data: ReadonlyArray<{ id: string; metadata: Stripe.Metadata | null }> }>;
      create: (params: Stripe.BillingPortal.ConfigurationCreateParams) => Promise<{ id: string }>;
    };
    sessions: {
      create: (params: Stripe.BillingPortal.SessionCreateParams) => Promise<{ url: string }>;
    };
  };
};

export type BillingPortalDependencies = {
  stripe: PortalStripeClient;
  prices: Record<BillingInterval, string>;
  /** The app origin the portal returns to. */
  baseUrl: string;
  getStripeCustomerId: (input: { userId: string }) => Promise<string | null>;
};

/**
 * The portal configuration of one version, created the first time one is
 * needed in each Stripe account, test or live, so no deployment depends on the
 * configuration someone left in the dashboard.
 */
async function ensureConfiguration(
  deps: BillingPortalDependencies,
  version: string,
  create: () => Promise<Stripe.BillingPortal.ConfigurationCreateParams>,
): Promise<string> {
  const { data } = await deps.stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  });
  const current = data.find((configuration) => configuration.metadata?.[VERSION_KEY] === version);
  if (current) return current.id;

  const created = await deps.stripe.billingPortal.configurations.create(await create());
  return created.id;
}

function ensurePortalConfiguration(deps: BillingPortalDependencies): Promise<string> {
  return ensureConfiguration(deps, PORTAL_CONFIGURATION_VERSION, async () => {
    const price = await deps.stripe.prices.retrieve(deps.prices.monthly);
    const product = typeof price.product === "string" ? price.product : price.product.id;
    return portalConfiguration({ product, prices: deps.prices });
  });
}

/**
 * Open the Stripe portal straight into cancelling one subscription at period
 * end, and come back to `returnPath` when it is done (#629). The restricted
 * area offers only this: the session uses the cancel-only configuration, opens
 * on the cancel flow, and returns to Tendnote on completion.
 */
export async function openSubscriptionCancel(
  deps: BillingPortalDependencies,
  input: { userId: string; stripeSubscriptionId: string; returnPath: string },
): Promise<string> {
  const customer = await deps.getStripeCustomerId({ userId: input.userId });
  if (!customer) throw new Error("There is no subscription to cancel.");

  const returnUrl = new URL(input.returnPath, deps.baseUrl).toString();
  const session = await deps.stripe.billingPortal.sessions.create({
    customer,
    return_url: returnUrl,
    configuration: await ensureConfiguration(
      deps,
      CANCEL_ONLY_PORTAL_CONFIGURATION_VERSION,
      async () => cancelOnlyPortalConfiguration(),
    ),
    flow_data: {
      type: "subscription_cancel",
      subscription_cancel: { subscription: input.stripeSubscriptionId },
      after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
    },
  });
  return session.url;
}

/**
 * Open the Stripe portal for one account and return the URL to send it to
 * (#609). Only an account Tendnote created a Stripe customer for has billing
 * to manage. The portal changes Stripe; Tendnote learns of each change from the
 * webhook, never from the return.
 */
export async function openBillingPortal(
  deps: BillingPortalDependencies,
  input: { userId: string },
): Promise<string> {
  const customer = await deps.getStripeCustomerId({ userId: input.userId });
  if (!customer) throw new Error("There is no billing to manage for this account.");

  const session = await deps.stripe.billingPortal.sessions.create({
    customer,
    configuration: await ensurePortalConfiguration(deps),
    return_url: new URL("/account", deps.baseUrl).toString(),
  });
  return session.url;
}

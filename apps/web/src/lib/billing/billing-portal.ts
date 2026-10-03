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
 * The portal configuration of the current version, created the first time
 * one is needed in each Stripe account, test or live, so no deployment depends
 * on the configuration someone left in the dashboard.
 */
async function ensurePortalConfiguration(deps: BillingPortalDependencies): Promise<string> {
  const { data } = await deps.stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  });
  const current = data.find(
    (configuration) => configuration.metadata?.[VERSION_KEY] === PORTAL_CONFIGURATION_VERSION,
  );
  if (current) return current.id;

  const price = await deps.stripe.prices.retrieve(deps.prices.monthly);
  const product = typeof price.product === "string" ? price.product : price.product.id;
  const created = await deps.stripe.billingPortal.configurations.create(
    portalConfiguration({ product, prices: deps.prices }),
  );
  return created.id;
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

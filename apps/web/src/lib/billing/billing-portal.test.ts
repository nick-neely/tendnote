import { describe, expect, it, vi } from "vitest";
import {
  type BillingPortalDependencies,
  openBillingPortal,
  PORTAL_CONFIGURATION_VERSION,
  portalConfiguration,
} from "./billing-portal";

const prices = { monthly: "price_monthly", annual: "price_annual" };

function portalHarness(existing: { id: string; metadata: Record<string, string> }[] = []) {
  const configurations = [...existing];
  const stripe = {
    prices: { retrieve: vi.fn(async () => ({ product: "prod_tendnote" })) },
    billingPortal: {
      configurations: {
        list: vi.fn(async () => ({ data: configurations })),
        create: vi.fn(async (params: ReturnType<typeof portalConfiguration>) => {
          const created = {
            id: `bpc_${configurations.length + 1}`,
            metadata: params.metadata ?? {},
          };
          configurations.push(created as { id: string; metadata: Record<string, string> });
          return created;
        }),
      },
      sessions: { create: vi.fn(async () => ({ url: "https://billing.stripe.test/session" })) },
    },
  };
  const deps: BillingPortalDependencies = {
    stripe: stripe as unknown as BillingPortalDependencies["stripe"],
    prices,
    baseUrl: "https://app.tendnote.test",
    getStripeCustomerId: async ({ userId }) => (userId === "subscriber-1" ? "cus_1" : null),
  };
  return { stripe, deps };
}

describe("the Stripe portal's configuration (#609)", () => {
  const { features } = portalConfiguration({ product: "prod_tendnote", prices });

  it("cancels at period end with no remainder refund", () => {
    expect(features.subscription_cancel).toEqual({
      enabled: true,
      mode: "at_period_end",
      proration_behavior: "none",
    });
  });

  it("switches monthly to annual at once and annual to monthly at the end of the paid year", () => {
    expect(features.subscription_update).toMatchObject({
      enabled: true,
      default_allowed_updates: ["price"],
      products: [{ product: "prod_tendnote", prices: ["price_monthly", "price_annual"] }],
      // A longer interval applies now and invoices the difference.
      proration_behavior: "always_invoice",
      // A shorter one waits for the period already paid to end.
      schedule_at_period_end: { conditions: [{ type: "shortening_interval" }] },
    });
  });

  it("updates the card but never the address the US billing country came from", () => {
    expect(features.payment_method_update).toEqual({ enabled: true });
    expect(features.customer_update).toEqual({ enabled: false });
  });
});

describe("opening the portal", () => {
  it("opens a session for the account's customer that returns to the account page", async () => {
    const { stripe, deps } = portalHarness();

    await expect(openBillingPortal(deps, { userId: "subscriber-1" })).resolves.toBe(
      "https://billing.stripe.test/session",
    );
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_1",
      configuration: "bpc_1",
      return_url: "https://app.tendnote.test/account",
    });
  });

  it("creates the configuration once and reuses it", async () => {
    const { stripe, deps } = portalHarness();

    await openBillingPortal(deps, { userId: "subscriber-1" });
    await openBillingPortal(deps, { userId: "subscriber-1" });

    expect(stripe.billingPortal.configurations.create).toHaveBeenCalledOnce();
    expect(stripe.billingPortal.sessions.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ configuration: "bpc_1" }),
    );
  });

  it("replaces a configuration from an earlier version or the dashboard", async () => {
    const { stripe, deps } = portalHarness([
      { id: "bpc_dashboard", metadata: {} },
      { id: "bpc_old", metadata: { tendnote_portal_configuration: "0" } },
    ]);

    await openBillingPortal(deps, { userId: "subscriber-1" });

    expect(stripe.billingPortal.configurations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { tendnote_portal_configuration: PORTAL_CONFIGURATION_VERSION },
      }),
    );
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: "bpc_3" }),
    );
  });

  it("refuses an account Tendnote never created a customer for", async () => {
    const { stripe, deps } = portalHarness();

    await expect(openBillingPortal(deps, { userId: "someone-else" })).rejects.toThrow(
      /no billing to manage/,
    );
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

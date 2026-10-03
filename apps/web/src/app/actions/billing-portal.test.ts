import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, requireAdmittedOwnerForAction, openBillingPortal } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  requireAdmittedOwnerForAction: vi.fn(),
  openBillingPortal: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@tendnote/auth", () => ({ resolveBetterAuthBaseUrl: () => "https://app.tendnote.test" }));
vi.mock("@tendnote/db/queries/stripe-customers", () => ({ getStripeCustomerId: vi.fn() }));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwnerForAction }));
vi.mock("@/lib/billing/billing-portal", () => ({ openBillingPortal }));

import { openBillingPortalAction } from "./billing-portal";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
  vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annual");
  requireAdmittedOwnerForAction.mockResolvedValue("subscriber-1");
  openBillingPortal.mockResolvedValue("https://billing.stripe.test/session");
});

describe("Manage billing (#609)", () => {
  it("sends an admitted account to its Stripe portal session", async () => {
    await expect(openBillingPortalAction()).rejects.toThrow(
      "REDIRECT:https://billing.stripe.test/session",
    );
    expect(openBillingPortal).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://app.tendnote.test" }),
      { userId: "subscriber-1" },
    );
  });

  it("refuses an account that is not admitted, a Lapsed one included", async () => {
    requireAdmittedOwnerForAction.mockRejectedValueOnce(
      new Error("Your subscription has ended. Resubscribe to do that."),
    );

    await expect(openBillingPortalAction()).rejects.toThrow(/Resubscribe/);
    expect(openBillingPortal).not.toHaveBeenCalled();
  });

  it("offers nothing on a deployment without Stripe, every self-hosted one included", async () => {
    vi.stubEnv("TENDNOTE_ADMISSION_MODE", "self-hosted");
    vi.stubEnv("TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL", "owner@example.com");

    await expect(openBillingPortalAction()).rejects.toThrow(/not available/);
    expect(openBillingPortal).not.toHaveBeenCalled();
  });
});

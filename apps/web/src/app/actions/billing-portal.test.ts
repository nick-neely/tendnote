import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  redirect,
  requireAdmittedOwnerForAction,
  getCurrentAccess,
  getLiveSubscription,
  openBillingPortal,
  openSubscriptionCancel,
} = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  requireAdmittedOwnerForAction: vi.fn(),
  getCurrentAccess: vi.fn(),
  getLiveSubscription: vi.fn(),
  openBillingPortal: vi.fn(),
  openSubscriptionCancel: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@tendnote/auth", () => ({ resolveBetterAuthBaseUrl: () => "https://app.tendnote.test" }));
vi.mock("@tendnote/db/queries/stripe-customers", () => ({ getStripeCustomerId: vi.fn() }));
vi.mock("@tendnote/db/queries/stripe-subscriptions", () => ({ getLiveSubscription }));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwnerForAction, getCurrentAccess }));
vi.mock("@/lib/billing/billing-portal", () => ({ openBillingPortal, openSubscriptionCancel }));

import { openBillingPortalAction, openSubscriptionCancelAction } from "./billing-portal";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
  vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annual");
  requireAdmittedOwnerForAction.mockResolvedValue("subscriber-1");
  openBillingPortal.mockResolvedValue("https://billing.stripe.test/session");
  getCurrentAccess.mockResolvedValue({ state: "restricted", user: { id: "suspended-1" } });
  getLiveSubscription.mockResolvedValue({ stripeSubscriptionId: "sub_1", cancelAt: null });
  openSubscriptionCancel.mockResolvedValue("https://billing.stripe.test/cancel");
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

describe("Cancel subscription from the restricted area (#629)", () => {
  it("sends a suspended account into the cancel flow for its live subscription", async () => {
    await expect(openSubscriptionCancelAction()).rejects.toThrow(
      "REDIRECT:https://billing.stripe.test/cancel",
    );
    expect(openSubscriptionCancel).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://app.tendnote.test" }),
      { userId: "suspended-1", stripeSubscriptionId: "sub_1", returnPath: "/restricted" },
    );
  });

  it("is only for a suspended account", async () => {
    getCurrentAccess.mockResolvedValueOnce({ state: "admitted", user: { id: "subscriber-1" } });

    await expect(openSubscriptionCancelAction()).rejects.toThrow(/no subscription to cancel here/);
    expect(openSubscriptionCancel).not.toHaveBeenCalled();
  });

  it("refuses without a live subscription, or once a cancellation is scheduled", async () => {
    for (const subscription of [null, { stripeSubscriptionId: "sub_1", cancelAt: new Date() }]) {
      getLiveSubscription.mockResolvedValueOnce(subscription);
      await expect(openSubscriptionCancelAction()).rejects.toThrow(
        "There is no subscription to cancel.",
      );
    }
    expect(openSubscriptionCancel).not.toHaveBeenCalled();
  });

  it("offers nothing on a deployment without Stripe", async () => {
    vi.stubEnv("TENDNOTE_ADMISSION_MODE", "self-hosted");
    vi.stubEnv("TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL", "owner@example.com");

    await expect(openSubscriptionCancelAction()).rejects.toThrow(/not available/);
    expect(openSubscriptionCancel).not.toHaveBeenCalled();
  });
});

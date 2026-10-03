import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  redirect,
  getCurrentAccess,
  isCheckoutOpen,
  openCheckout,
  captureRequestFunnelStage,
  requestHeaders,
} = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
  isCheckoutOpen: vi.fn(),
  openCheckout: vi.fn(),
  captureRequestFunnelStage: vi.fn(),
  requestHeaders: new Headers({ "x-vercel-ip-country": "US" }),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("@/lib/telemetry/account-funnel", () => ({ captureRequestFunnelStage }));
vi.mock("@tendnote/auth", () => ({ resolveBetterAuthBaseUrl: () => "https://app.tendnote.test" }));
vi.mock("@tendnote/db/queries/stripe-customers", () => ({
  getStripeCustomerId: vi.fn(),
  recordStripeCustomer: vi.fn(),
}));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess }));
vi.mock("@/lib/billing/checkout-availability", () => ({ isCheckoutOpen }));
vi.mock("@/lib/billing/checkout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/checkout")>()),
  openCheckout,
}));

import { startCheckoutAction } from "./checkout";

const user = { id: "subscriber-1", email: "subscriber@example.com" };

function intervalForm(interval: string) {
  const form = new FormData();
  form.set("interval", interval);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
  vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annual");
  getCurrentAccess.mockResolvedValue({ state: "pending", user });
  isCheckoutOpen.mockResolvedValue(true);
  openCheckout.mockResolvedValue("https://checkout.stripe.test/c/pay_1");
});

describe("Subscribe from the pending area", () => {
  it("sends a pending account to Stripe Checkout for the chosen interval", async () => {
    await expect(startCheckoutAction(intervalForm("annual"))).rejects.toThrow(
      "REDIRECT:https://checkout.stripe.test/c/pay_1",
    );
    expect(openCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://app.tendnote.test" }),
      { userId: user.id, email: user.email, interval: "annual" },
    );
  });

  it("captures the checkout start for the account funnel with the request's own headers", async () => {
    await expect(startCheckoutAction(intervalForm("annual"))).rejects.toThrow("REDIRECT:");

    expect(captureRequestFunnelStage).toHaveBeenCalledExactlyOnceWith({
      userId: user.id,
      stage: "checkout_started",
      headers: requestHeaders,
    });
  });

  it("lets a Lapsed account resubscribe (#609)", async () => {
    getCurrentAccess.mockResolvedValueOnce({
      state: "lapsed",
      user,
      retentionDeadline: new Date("2027-01-29T17:04:05.000Z"),
    });

    await expect(startCheckoutAction(intervalForm("monthly"))).rejects.toThrow(
      "REDIRECT:https://checkout.stripe.test/c/pay_1",
    );
    expect(openCheckout).toHaveBeenCalledWith(expect.anything(), {
      userId: user.id,
      email: user.email,
      interval: "monthly",
    });
  });

  it("sends a signed-out visitor to sign in and an admitted account home", async () => {
    getCurrentAccess.mockResolvedValueOnce({ state: "unauthenticated" });
    await expect(startCheckoutAction(intervalForm("monthly"))).rejects.toThrow("REDIRECT:/sign-in");

    getCurrentAccess.mockResolvedValueOnce({ state: "admitted", user, ownerUserId: user.id });
    await expect(startCheckoutAction(intervalForm("monthly"))).rejects.toThrow("REDIRECT:/");

    expect(openCheckout).not.toHaveBeenCalled();
    expect(captureRequestFunnelStage).not.toHaveBeenCalled();
  });

  it("opens nothing while Checkout is closed, unconfigured, or asked for an unknown interval", async () => {
    isCheckoutOpen.mockResolvedValueOnce(false);
    await expect(startCheckoutAction(intervalForm("monthly"))).rejects.toThrow(/not available/);

    await expect(startCheckoutAction(intervalForm("weekly"))).rejects.toThrow(/not available/);

    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await expect(startCheckoutAction(intervalForm("monthly"))).rejects.toThrow(/not available/);

    expect(openCheckout).not.toHaveBeenCalled();
  });
});

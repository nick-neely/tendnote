import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
  isCheckoutOpen: vi.fn(),
  getHouseholdOverviewForUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess: mocks.getCurrentAccess }));
vi.mock("@/lib/billing/checkout-availability", () => ({ isCheckoutOpen: mocks.isCheckoutOpen }));
vi.mock("@tendnote/db/queries/households", () => ({
  getHouseholdOverviewForUser: mocks.getHouseholdOverviewForUser,
}));
vi.mock("@/components/auth/auth-scaffold", () => ({
  AuthScaffold: ({ title, subtitle, children }: Record<string, React.ReactNode>) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </main>
  ),
}));
vi.mock("@/components/billing/subscribe-form", () => ({ SubscribeForm: () => <b>Subscribe</b> }));
vi.mock("@/components/auth/sign-out-button", () => ({ SignOutButton: () => <b>Sign out</b> }));
vi.mock("@/components/account/delete-account-button", () => ({
  DeleteAccountButton: () => <b>Delete</b>,
}));

import GuestPage from "./page";

const user = { id: "guest-1", email: "guest@example.com", name: "Mara" };

async function renderGuest() {
  return renderToStaticMarkup(await GuestPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAccess.mockResolvedValue({ state: "guest", user, householdId: "household-1" });
  mocks.isCheckoutOpen.mockResolvedValue(true);
  mocks.getHouseholdOverviewForUser.mockResolvedValue({ name: "The Neely house" });
});

describe("the guest area (#635)", () => {
  it("names the household and says the view is read-only and the records are its members'", async () => {
    const html = await renderGuest();

    expect(html).toContain("The Neely house");
    expect(html).toMatch(/read-only/i);
    expect(html).toMatch(/belong to its members/i);
    expect(html).toContain("guest@example.com");
    expect(mocks.getHouseholdOverviewForUser).toHaveBeenCalledWith({ userId: user.id });
  });

  it("offers no paid affordance beyond subscribing, and always the account's own exits", async () => {
    const html = await renderGuest();

    expect(html).toContain("Subscribe");
    expect(html).toContain("Sign out");
    expect(html).toContain("Delete");
    expect(html).not.toMatch(/\b(Eve|assistant|export|capture|remind)\b/i);
  });

  it("hides subscribing while Checkout is closed", async () => {
    mocks.isCheckoutOpen.mockResolvedValue(false);

    expect(await renderGuest()).not.toContain("Subscribe");
  });

  it.each([
    [{ state: "pending", user }, "/pending"],
    [{ state: "admitted", user, ownerUserId: user.id }, "/"],
    [{ state: "unauthenticated" }, "/sign-in"],
  ])("sends %o where it belongs", async (access, to) => {
    mocks.getCurrentAccess.mockResolvedValue(access);

    await expect(renderGuest()).rejects.toThrow(`REDIRECT:${to}`);
  });
});

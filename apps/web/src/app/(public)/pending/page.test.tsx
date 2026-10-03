import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
  isCheckoutOpen: vi.fn(),
  getStripeCustomerId: vi.fn(),
  ownerHasExportableData: vi.fn(),
  getLatestOwnerDataExportJob: vi.fn(),
  readGuestStanding: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess: mocks.getCurrentAccess }));
vi.mock("@/lib/billing/checkout-availability", () => ({ isCheckoutOpen: mocks.isCheckoutOpen }));
vi.mock("@tendnote/db/queries/stripe-customers", () => ({
  getStripeCustomerId: mocks.getStripeCustomerId,
}));
vi.mock("@tendnote/db/queries/owner-data-export", () => ({
  ownerHasExportableData: mocks.ownerHasExportableData,
  getLatestOwnerDataExportJob: mocks.getLatestOwnerDataExportJob,
}));
vi.mock("@tendnote/db/queries/households", () => ({
  readGuestStanding: mocks.readGuestStanding,
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
vi.mock("@/components/account/owner-data-export-section", () => ({
  OwnerDataExportSection: () => <b>Export</b>,
}));
vi.mock("@/components/auth/sign-out-button", () => ({ SignOutButton: () => <b>Sign out</b> }));
vi.mock("@/components/account/delete-account-button", () => ({
  DeleteAccountButton: () => <b>Delete</b>,
}));

import PendingPage from "./page";

const user = { id: "newcomer-1", email: "newcomer@example.com", name: "" };

async function renderPending() {
  return renderToStaticMarkup(await PendingPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAccess.mockResolvedValue({ state: "pending", user });
  mocks.isCheckoutOpen.mockResolvedValue(true);
  mocks.getStripeCustomerId.mockResolvedValue(null);
  mocks.ownerHasExportableData.mockResolvedValue(false);
  mocks.getLatestOwnerDataExportJob.mockResolvedValue(null);
  mocks.readGuestStanding.mockResolvedValue(null);
});

describe("the pending area (#607)", () => {
  it("shows a never-subscribed account its line, identity, Subscribe, Delete, and Sign out", async () => {
    const html = await renderPending();

    expect(html).toContain("Your account is ready. Nothing has been charged.");
    expect(html).toContain("newcomer@example.com");
    expect(html).toContain("<b>Subscribe</b>");
    expect(html).toContain("<b>Delete</b>");
    expect(html).toContain("<b>Sign out</b>");
    expect(html).not.toContain("<b>Export</b>");
  });

  it("tells a returning account its checkout didn't finish", async () => {
    mocks.getStripeCustomerId.mockResolvedValue("cus_newcomer");

    const html = await renderPending();

    expect(html).toContain("Finish subscribing");
    expect(html).toContain("Your subscription hasn&#x27;t started yet. Just paid?");
  });

  it("offers Export only to an account that owns something to export", async () => {
    mocks.ownerHasExportableData.mockResolvedValue(true);

    const html = await renderPending();

    expect(html).toContain("<b>Export</b>");
    expect(mocks.getLatestOwnerDataExportJob).toHaveBeenCalledWith(user.id);
  });

  it("keeps Delete and Sign out while Checkout is closed", async () => {
    mocks.isCheckoutOpen.mockResolvedValue(false);

    const html = await renderPending();

    expect(html).toContain("Pending review");
    expect(html).not.toContain("<b>Subscribe</b>");
    expect(html).toContain("<b>Delete</b>");
    expect(html).toContain("<b>Sign out</b>");
  });

  it("still tells an account its checkout didn't finish while Checkout is closed", async () => {
    mocks.isCheckoutOpen.mockResolvedValue(false);
    mocks.getStripeCustomerId.mockResolvedValue("cus_newcomer");

    const html = await renderPending();

    expect(html).toContain("Your subscription hasn&#x27;t started");
    expect(html).not.toContain("Pending review");
    expect(html).not.toContain("<b>Subscribe</b>");
    expect(html).toContain("<b>Delete</b>");
  });

  it("sends an admitted account home and a signed-out visitor to sign in", async () => {
    mocks.getCurrentAccess.mockResolvedValueOnce({ state: "admitted", user, ownerUserId: user.id });
    await expect(PendingPage()).rejects.toThrow("REDIRECT:/");

    mocks.getCurrentAccess.mockResolvedValueOnce({ state: "unauthenticated" });
    await expect(PendingPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("is not the home of a Lapsed account, which has its own area (#609)", async () => {
    mocks.getCurrentAccess.mockResolvedValueOnce({
      state: "lapsed",
      user,
      retentionDeadline: new Date("2027-01-29T17:04:05.000Z"),
    });

    await expect(PendingPage()).rejects.toThrow("REDIRECT:/lapsed");
  });
});

describe("the pending area for a guest that is not one now (#637)", () => {
  it("tells a guest whose household lost its last paying Owner, with Subscribe, Delete, and Sign out", async () => {
    mocks.readGuestStanding.mockResolvedValue("household_inactive");

    const html = await renderPending();

    expect(mocks.readGuestStanding).toHaveBeenCalledWith({ userId: user.id });
    expect(html).toContain('data-pending-state="household_inactive"');
    expect(html).toContain("This household is not currently active on Tendnote");
    expect(html).toContain("<b>Subscribe</b>");
    expect(html).toContain("<b>Delete</b>");
    expect(html).toContain("<b>Sign out</b>");
    expect(html).not.toContain("<b>Export</b>");
    expect(html).not.toContain("Pending review");
  });

  it("tells a removed guest its membership ended, with Subscribe, Delete, and Sign out", async () => {
    mocks.readGuestStanding.mockResolvedValue("membership_ended");

    const html = await renderPending();

    expect(html).toContain('data-pending-state="membership_ended"');
    expect(html).toContain("Your household membership ended");
    expect(html).toContain("<b>Subscribe</b>");
    expect(html).toContain("<b>Delete</b>");
    expect(html).toContain("<b>Sign out</b>");
  });
});

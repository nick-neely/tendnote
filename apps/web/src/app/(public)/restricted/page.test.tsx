import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
  getLiveSubscription: vi.fn(),
  ownerHasExportableData: vi.fn(),
  getLatestOwnerDataExportJob: vi.fn(),
  isAccountHeld: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess: mocks.getCurrentAccess }));
vi.mock("@tendnote/db/queries/legal-holds", () => ({ isAccountHeld: mocks.isAccountHeld }));
vi.mock("@tendnote/db/queries/stripe-subscriptions", () => ({
  getLiveSubscription: mocks.getLiveSubscription,
}));
vi.mock("@tendnote/db/queries/owner-data-export", () => ({
  ownerHasExportableData: mocks.ownerHasExportableData,
  getLatestOwnerDataExportJob: mocks.getLatestOwnerDataExportJob,
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
vi.mock("@/components/billing/cancel-subscription-button", () => ({
  CancelSubscriptionButton: () => <b>Cancel subscription</b>,
}));
vi.mock("@/components/account/owner-data-export-section", () => ({
  OwnerDataExportSection: () => <b>Export</b>,
}));
vi.mock("@/components/auth/sign-out-button", () => ({ SignOutButton: () => <b>Sign out</b> }));
vi.mock("@/components/account/delete-account-button", () => ({
  DeleteAccountButton: () => <b>Delete</b>,
}));

import RestrictedPage from "./page";

const user = { id: "suspended-1", email: "suspended@example.com", name: "Sam" };

async function renderRestricted() {
  return renderToStaticMarkup(await RestrictedPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAccess.mockResolvedValue({
    state: "restricted",
    user,
    restriction: { kind: "suspension" },
  });
  mocks.getLiveSubscription.mockResolvedValue({ stripeSubscriptionId: "sub_1", cancelAt: null });
  mocks.ownerHasExportableData.mockResolvedValue(true);
  mocks.getLatestOwnerDataExportJob.mockResolvedValue(null);
  mocks.isAccountHeld.mockResolvedValue(false);
});

describe("the restricted area (#629)", () => {
  it("says the account is under review and states the credit rule, with no figure", async () => {
    const html = await renderRestricted();

    expect(html).toContain("Your account is under review");
    expect(html).toContain("credited back when it ends");
    expect(html).not.toMatch(/\$\d/);
  });

  it("offers exactly export, deletion, and cancel, beside the signed-in identity and Sign out", async () => {
    const html = await renderRestricted();

    expect(html).toContain("suspended@example.com");
    for (const action of ["Cancel subscription", "Export", "Delete", "Sign out"]) {
      expect(html).toContain(`<b>${action}</b>`);
    }
    expect(html.match(/<b>/g)).toHaveLength(4);
  });

  it("states a cancellation already scheduled instead of offering another", async () => {
    mocks.getLiveSubscription.mockResolvedValue({
      stripeSubscriptionId: "sub_1",
      cancelAt: new Date("2026-11-03T12:00:00.000Z"),
    });

    const html = await renderRestricted();

    expect(html).not.toContain("<b>Cancel subscription</b>");
    expect(html).toContain("Your subscription ends on November 3, 2026.");
  });

  it("offers no billing at all without a live subscription", async () => {
    mocks.getLiveSubscription.mockResolvedValue(null);

    const html = await renderRestricted();

    expect(html).not.toContain("Cancel subscription");
    expect(html).not.toContain("credited");
  });

  it("offers export only when there is something to export", async () => {
    mocks.ownerHasExportableData.mockResolvedValue(false);

    const html = await renderRestricted();

    expect(html).not.toContain("<b>Export</b>");
    expect(mocks.getLatestOwnerDataExportJob).not.toHaveBeenCalled();
  });

  it("sends every other account where it belongs, so a lift leaves the area", async () => {
    mocks.getCurrentAccess.mockResolvedValueOnce({ state: "unauthenticated" });
    await expect(renderRestricted()).rejects.toThrow("REDIRECT:/sign-in");

    mocks.getCurrentAccess.mockResolvedValueOnce({ state: "admitted", user, ownerUserId: user.id });
    await expect(renderRestricted()).rejects.toThrow("REDIRECT:/");

    mocks.getCurrentAccess.mockResolvedValueOnce({
      state: "lapsed",
      user,
      retentionDeadline: new Date(),
    });
    await expect(renderRestricted()).rejects.toThrow("REDIRECT:/lapsed");
  });
});

describe("the restricted area after a Termination (#630)", () => {
  beforeEach(() => {
    mocks.getCurrentAccess.mockResolvedValue({
      state: "restricted",
      user,
      restriction: {
        kind: "termination",
        retentionDeadline: new Date("2027-01-07T09:30:00.000Z"),
      },
    });
  });

  it("says access has ended, the renewal is stopped, and when the data is deleted", async () => {
    const html = await renderRestricted();

    expect(html).toContain("Your access to Tendnote has ended");
    expect(html).toContain("won&#x27;t renew");
    expect(html).toContain("Your data is kept until January 7, 2027, then deleted.");
    expect(html).not.toContain("under review");
    expect(html).not.toContain("credited");
  });

  it("promises no deletion date while a Legal Hold pauses the deletion, and does not name it (#632)", async () => {
    mocks.isAccountHeld.mockResolvedValue(true);

    const html = await renderRestricted();

    expect(mocks.isAccountHeld).toHaveBeenCalledWith({ userId: user.id });
    expect(html).toContain("Your data is kept as it is, and nothing has been deleted.");
    expect(html).not.toContain("January 7, 2027");
    expect(html).not.toMatch(/hold/i);
  });

  it("offers exactly export and deletion, with no billing and no resubscribe", async () => {
    const html = await renderRestricted();

    for (const action of ["Export", "Delete", "Sign out"]) {
      expect(html).toContain(`<b>${action}</b>`);
    }
    expect(html.match(/<b>/g)).toHaveLength(3);
    expect(html).not.toMatch(/subscribe/i);
    expect(mocks.getLiveSubscription).not.toHaveBeenCalled();
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
  isCheckoutOpen: vi.fn(),
  ownerHasExportableData: vi.fn(),
  getLatestOwnerDataExportJob: vi.fn(),
  isAccountHeld: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess: mocks.getCurrentAccess }));
vi.mock("@tendnote/db/queries/legal-holds", () => ({ isAccountHeld: mocks.isAccountHeld }));
vi.mock("@/lib/billing/checkout-availability", () => ({ isCheckoutOpen: mocks.isCheckoutOpen }));
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
vi.mock("@/components/billing/subscribe-form", () => ({ SubscribeForm: () => <b>Subscribe</b> }));
vi.mock("@/components/account/owner-data-export-section", () => ({
  OwnerDataExportSection: () => <b>Export</b>,
}));
vi.mock("@/components/auth/sign-out-button", () => ({ SignOutButton: () => <b>Sign out</b> }));
vi.mock("@/components/account/delete-account-button", () => ({
  DeleteAccountButton: () => <b>Delete</b>,
}));

import LapsedPage from "./page";

const user = { id: "former-1", email: "former@example.com", name: "Sam" };
const retentionDeadline = new Date("2027-01-29T17:04:05.000Z");

async function renderLapsed() {
  return renderToStaticMarkup(await LapsedPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAccess.mockResolvedValue({ state: "lapsed", user, retentionDeadline });
  mocks.isCheckoutOpen.mockResolvedValue(true);
  mocks.ownerHasExportableData.mockResolvedValue(true);
  mocks.getLatestOwnerDataExportJob.mockResolvedValue(null);
  mocks.isAccountHeld.mockResolvedValue(false);
});

describe("the Lapsed area (#609)", () => {
  it("shows the retention date set on entering Lapsed", async () => {
    const html = await renderLapsed();

    expect(html).toContain("Your subscription has ended");
    expect(html).toContain("Your data is kept until January 29, 2027, then deleted.");
  });

  it("promises no deletion date while a Legal Hold pauses the deletion, and does not name it (#632)", async () => {
    mocks.isAccountHeld.mockResolvedValue(true);

    const html = await renderLapsed();

    expect(mocks.isAccountHeld).toHaveBeenCalledWith({ userId: user.id });
    expect(html).toContain("Your data is kept as it is, and nothing has been deleted.");
    expect(html).not.toContain("January 29, 2027");
    expect(html).not.toMatch(/hold/i);
    for (const action of ["Subscribe", "Export", "Delete", "Sign out"]) {
      expect(html).toContain(`<b>${action}</b>`);
    }
  });

  it("offers exactly resubscribe, export, and delete, beside the signed-in identity and Sign out", async () => {
    const html = await renderLapsed();

    expect(html).toContain("former@example.com");
    for (const action of ["Subscribe", "Export", "Delete", "Sign out"]) {
      expect(html).toContain(`<b>${action}</b>`);
    }
    expect(html.match(/<b>/g)).toHaveLength(4);
  });

  it("offers export only when there is something to export", async () => {
    mocks.ownerHasExportableData.mockResolvedValue(false);

    const html = await renderLapsed();

    expect(html).not.toContain("<b>Export</b>");
    expect(mocks.getLatestOwnerDataExportJob).not.toHaveBeenCalled();
  });

  it("sends a never-paid account to the pending area and an admitted one home", async () => {
    mocks.getCurrentAccess.mockResolvedValueOnce({ state: "pending", user });
    await expect(renderLapsed()).rejects.toThrow("REDIRECT:/pending");

    mocks.getCurrentAccess.mockResolvedValueOnce({ state: "admitted", user, ownerUserId: user.id });
    await expect(renderLapsed()).rejects.toThrow("REDIRECT:/");
  });
});

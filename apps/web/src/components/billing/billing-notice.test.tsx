import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { admittedOwnerOrNull, getScheduledCancellation } = vi.hoisted(() => ({
  admittedOwnerOrNull: vi.fn(),
  getScheduledCancellation: vi.fn(),
}));

vi.mock("@/lib/access/current-access", () => ({ admittedOwnerOrNull }));
vi.mock("@tendnote/db/queries/stripe-subscriptions", () => ({ getScheduledCancellation }));
vi.mock("./manage-billing-button", () => ({
  ManageBillingButton: () => <b>Manage billing</b>,
}));

import { EndingNoticeBanner } from "./billing-notice";

async function renderNotice() {
  const notice = await EndingNoticeBanner();
  return notice ? renderToStaticMarkup(notice) : "";
}

beforeEach(() => {
  vi.clearAllMocks();
  admittedOwnerOrNull.mockResolvedValue("subscriber-1");
  getScheduledCancellation.mockResolvedValue(null);
});

describe("the Ending notice (#609)", () => {
  it("shows when a scheduled cancellation ends, with the way to change it", async () => {
    getScheduledCancellation.mockResolvedValue(new Date("2026-04-15T17:04:05.000Z"));

    const html = await renderNotice();

    expect(html).toContain("Your subscription ends on April 15, 2026.");
    expect(html).toContain("You keep full access until then.");
    expect(html).toContain("<b>Manage billing</b>");
    expect(getScheduledCancellation).toHaveBeenCalledWith({ userId: "subscriber-1" });
  });

  it("shows nothing for a subscription that renews, or once it is reversed", async () => {
    await expect(renderNotice()).resolves.toBe("");
  });

  it("shows nothing to an account that is not admitted", async () => {
    admittedOwnerOrNull.mockResolvedValue(null);

    await expect(renderNotice()).resolves.toBe("");
    expect(getScheduledCancellation).not.toHaveBeenCalled();
  });

  it("shows nothing rather than break the shell when the read fails", async () => {
    getScheduledCancellation.mockRejectedValue(new Error("database unavailable"));

    await expect(renderNotice()).resolves.toBe("");
  });
});

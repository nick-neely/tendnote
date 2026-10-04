import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { admittedOwnerOrNull, getBillingStanding } = vi.hoisted(() => ({
  admittedOwnerOrNull: vi.fn(),
  getBillingStanding: vi.fn(),
}));

vi.mock("@/lib/access/current-access", () => ({ admittedOwnerOrNull }));
vi.mock("@tendnote/db/queries/stripe-subscriptions", () => ({ getBillingStanding }));
vi.mock("./manage-billing-button", () => ({
  ManageBillingButton: () => <b>Manage billing</b>,
}));

import { BillingNoticeBanner } from "./billing-notice";

async function renderNotice() {
  const notice = await BillingNoticeBanner();
  return notice ? renderToStaticMarkup(notice) : "";
}

beforeEach(() => {
  vi.clearAllMocks();
  admittedOwnerOrNull.mockResolvedValue("subscriber-1");
  getBillingStanding.mockResolvedValue({ endsAt: null, pastDueUntil: null });
});

describe("the Ending notice (#609)", () => {
  it("shows when a scheduled cancellation ends, with the way to change it", async () => {
    getBillingStanding.mockResolvedValue({
      endsAt: new Date("2026-04-15T17:04:05.000Z"),
      pastDueUntil: null,
    });

    const html = await renderNotice();

    expect(html).toContain("Your subscription ends on April 15, 2026.");
    expect(html).toContain("You keep full access until then.");
    expect(html).toContain("<b>Manage billing</b>");
    expect(getBillingStanding).toHaveBeenCalledWith({ userId: "subscriber-1" });
  });

  it("shows nothing for a subscription that renews, or once it is reversed", async () => {
    await expect(renderNotice()).resolves.toBe("");
  });

  it("shows nothing to an account that is not admitted", async () => {
    admittedOwnerOrNull.mockResolvedValue(null);

    await expect(renderNotice()).resolves.toBe("");
    expect(getBillingStanding).not.toHaveBeenCalled();
  });

  it("shows nothing rather than break the shell when the read fails", async () => {
    getBillingStanding.mockRejectedValue(new Error("database unavailable"));

    await expect(renderNotice()).resolves.toBe("");
  });
});

describe("the Past Due notice (#610)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T10:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows the days of full access left, with the way to fix the card", async () => {
    getBillingStanding.mockResolvedValue({
      endsAt: null,
      pastDueUntil: new Date("2026-11-08T10:30:00Z"),
    });

    const html = await renderNotice();

    expect(html).toContain("Your renewal payment didn&#x27;t go through.");
    expect(html).toContain("Full access continues for 5 more days. Update your card to keep it.");
    expect(html).toContain("<b>Manage billing</b>");
  });

  it("comes before the Ending notice when a cancelled subscription's renewal also failed", async () => {
    getBillingStanding.mockResolvedValue({
      endsAt: new Date("2026-12-01T10:30:00Z"),
      pastDueUntil: new Date("2026-11-08T10:30:00Z"),
    });

    const html = await renderNotice();

    expect(html).toContain("didn&#x27;t go through");
    expect(html).not.toContain("Your subscription ends");
  });
});

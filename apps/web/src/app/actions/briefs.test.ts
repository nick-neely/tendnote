import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateManualBrief, revalidatePath, requireAdmittedOwnerForAction, enforceProductBudget } =
  vi.hoisted(() => ({
    generateManualBrief: vi.fn(),
    revalidatePath: vi.fn(),
    requireAdmittedOwnerForAction: vi.fn().mockResolvedValue("user-1"),
    enforceProductBudget: vi.fn(),
  }));

vi.mock("@tendnote/db/queries/briefs", () => ({
  generateManualBrief,
  acceptBriefSuggestedFollowup: vi.fn(),
  dismissBriefItem: vi.fn(),
  snoozeBriefItem: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwnerForAction }));
vi.mock("@/lib/brief-local-date", () => ({ currentLocalDate: () => "2026-06-29" }));
vi.mock("@/lib/rate-limit/guards", () => ({ enforceProductBudget }));

import { generateBriefAction } from "./briefs";

beforeEach(() => {
  generateManualBrief.mockReset();
  revalidatePath.mockReset();
  enforceProductBudget.mockReset();
  requireAdmittedOwnerForAction.mockResolvedValue("user-1");
});

describe("generateBriefAction product budget", () => {
  it("charges the server-action budget and generates while under budget", async () => {
    generateManualBrief.mockResolvedValue({
      brief: { id: "brief-1" },
      outcome: "generated",
    });

    await generateBriefAction({ cadence: "daily" });

    expect(enforceProductBudget).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "user-1", costCategory: "server-action" }),
    );
    expect(generateManualBrief).toHaveBeenCalledTimes(1);
  });

  it("does not generate when the budget is exceeded", async () => {
    enforceProductBudget.mockRejectedValueOnce(new Error("rate limited"));

    await expect(generateBriefAction({ cadence: "daily" })).rejects.toThrow();
    expect(generateManualBrief).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductRateLimitError } from "@/lib/rate-limit/errors";
import {
  enforceProductBudgetSpy,
  requireAdmittedOwnerForActionSpy,
} from "@/test/action-adapter-mocks";

const { generateManualBrief } = vi.hoisted(() => ({
  generateManualBrief: vi.fn(),
}));

vi.mock("@tendnote/db/queries/briefs", () => ({
  generateManualBrief,
  acceptBriefSuggestedFollowup: vi.fn(),
  dismissBriefItem: vi.fn(),
  snoozeBriefItem: vi.fn(),
}));
vi.mock("@/lib/brief-local-date", () => ({ currentLocalDate: () => "2026-06-29" }));

import { generateBriefAction } from "./briefs";

beforeEach(() => {
  generateManualBrief.mockReset();
  enforceProductBudgetSpy.mockReset();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("user-1");
});

describe("generateBriefAction product budget", () => {
  it("charges the server-action budget and generates while under budget", async () => {
    generateManualBrief.mockResolvedValue({
      result: {
        brief: { id: "brief-1", cadence: "daily" },
        outcome: "created",
      },
      affectedScopes: [{ kind: "owner-collection", collection: "briefs", ownerUserId: "user-1" }],
    });

    await generateBriefAction({ cadence: "daily" });

    expect(enforceProductBudgetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "user-1", costCategory: "server-action" }),
    );
    expect(generateManualBrief).toHaveBeenCalledTimes(1);
  });

  it("does not generate when the budget is exceeded", async () => {
    enforceProductBudgetSpy.mockRejectedValueOnce(
      new ProductRateLimitError({
        allowed: false,
        limit: 1,
        count: 2,
        remaining: 0,
        resetAt: new Date("2026-07-28T03:00:00Z"),
        costCategory: "server-action",
        reason: "limit_exceeded",
      }),
    );

    await expect(generateBriefAction({ cadence: "daily" })).resolves.toEqual({
      ok: false,
      error: "You've reached a usage limit for this action. Please try again shortly.",
    });
    expect(generateManualBrief).not.toHaveBeenCalled();
  });
});

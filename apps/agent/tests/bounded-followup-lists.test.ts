import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, parseToolInput } from "./test-tool";

/**
 * The two follow-up list tools promise "a small set" and used to deliver whatever
 * the owner had.
 *
 * The shared store applies no `LIMIT` when the caller omits one, so an unqualified
 * "what's due?" pulled the entire open ledger into a chat turn, and "any follow-ups
 * to review?" rendered a review card per open suggestion. The bound lives in each
 * tool's input schema rather than in the store, because the web reads the same
 * functions and its ledger surfaces legitimately want everything.
 *
 * Parsing through `inputSchema` is what Eve does before calling `execute`, so these
 * exercise the same path production takes.
 */
const mocks = vi.hoisted(() => ({
  listActiveFollowups: vi.fn(),
  listSuggestedFollowupReviews: vi.fn(),
  getOwnerTodayContext: vi.fn(),
}));

vi.mock("@tendnote/db/queries/followups", () => ({
  listActiveFollowups: mocks.listActiveFollowups,
  listSuggestedFollowupReviews: mocks.listSuggestedFollowupReviews,
}));
vi.mock("@tendnote/db/queries/today", () => ({
  getOwnerTodayContext: mocks.getOwnerTodayContext,
}));

const { default: rawDueTool } = await import("../agent/tools/list_due_followups");
const { default: rawReviewsTool } = await import("../agent/tools/list_suggested_followup_reviews");
const dueTool = asTestTool(rawDueTool);
const reviewsTool = asTestTool(rawReviewsTool);

const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listActiveFollowups.mockResolvedValue([]);
  mocks.listSuggestedFollowupReviews.mockResolvedValue([]);
  mocks.getOwnerTodayContext.mockResolvedValue({
    localDate: "2026-07-04",
    timeZone: "UTC",
    now: new Date("2026-07-04T12:00:00.000Z"),
  });
});

describe("list_due_followups is bounded by default", () => {
  it("passes a default limit down to the shared store", async () => {
    await dueTool.execute(parseToolInput(dueTool, {}), ctx);

    expect(mocks.listActiveFollowups).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
  });

  it("still honours an explicit limit and refuses one past the cap", async () => {
    await dueTool.execute(parseToolInput(dueTool, { limit: 5 }), ctx);

    expect(mocks.listActiveFollowups).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    expect(() => parseToolInput(dueTool, { limit: 500 })).toThrow();
  });
});

describe("list_suggested_followup_reviews is bounded by default", () => {
  it("passes a default limit down to the shared store", async () => {
    await reviewsTool.execute(parseToolInput(reviewsTool, {}), ctx);

    expect(mocks.listSuggestedFollowupReviews).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });

  it("still honours an explicit limit and refuses one past the cap", async () => {
    await reviewsTool.execute(parseToolInput(reviewsTool, { limit: 3 }), ctx);

    expect(mocks.listSuggestedFollowupReviews).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3 }),
    );
    expect(() => parseToolInput(reviewsTool, { limit: 200 })).toThrow();
  });
});

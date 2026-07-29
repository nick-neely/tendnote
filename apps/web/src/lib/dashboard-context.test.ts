import { beforeEach, describe, expect, it, vi } from "vitest";

const { listActiveFollowups, listCalendarSuggestedFollowups, listSuggestedFollowupReviews } =
  vi.hoisted(() => ({
    listActiveFollowups: vi.fn(),
    listCalendarSuggestedFollowups: vi.fn(),
    listSuggestedFollowupReviews: vi.fn(),
  }));

// `server-only` throws outside an RSC bundle; stub it so the module loads here.
vi.mock("server-only", () => ({}));
// `cache` memoizes per request. Outside one, it would hand a later assertion the
// first test's reads, so each call has to reach the mocked query.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock("@tendnote/db/queries/followups", () => ({
  listActiveFollowups,
  listSuggestedFollowupReviews,
}));
vi.mock("@tendnote/db/queries/calendar-followups", () => ({ listCalendarSuggestedFollowups }));
vi.mock("@tendnote/db/queries/people", () => ({ searchPeople: vi.fn() }));

import {
  dashboardActiveFollowups,
  dashboardCalendarSuggestions,
  dashboardSuggestedFollowups,
} from "./dashboard-context";
import { followupHorizonFrom } from "./followup-horizon";

const OWNER = "owner-1";
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

beforeEach(() => {
  vi.clearAllMocks();
  listActiveFollowups.mockResolvedValue([]);
  listSuggestedFollowupReviews.mockResolvedValue([]);
  listCalendarSuggestedFollowups.mockResolvedValue([]);
});

/**
 * The three feeds behind the Follow-ups tab share one list and one count, so a
 * horizon applied to only one of them is no horizon at all: a birthday follow-up
 * suggested for next year would still fill the tab that promises the next two
 * weeks. These pin all three to the same bound.
 */
describe("dashboard Follow-ups horizon", () => {
  it("bounds active reminders at the horizon", async () => {
    await dashboardActiveFollowups(OWNER);

    const input = listActiveFollowups.mock.calls[0]?.[0];
    expect(input.dueBefore.getTime()).toBeCloseTo(followupHorizonFrom(new Date()).getTime(), -3);
  });

  it("drops suggested follow-ups due past the horizon", async () => {
    listSuggestedFollowupReviews.mockResolvedValue([
      { followup: { id: "near", dueAt: inDays(3) } },
      { followup: { id: "birthday-next-year", dueAt: inDays(300) } },
    ]);

    const reviews = await dashboardSuggestedFollowups(OWNER);

    expect(reviews.map((review) => review.followup.id)).toEqual(["near"]);
  });

  it("drops Calendar suggestions due past the horizon", async () => {
    listCalendarSuggestedFollowups.mockResolvedValue([
      { id: "far", dueAt: inDays(90) },
      { id: "near", dueAt: inDays(1) },
    ]);

    const suggestions = await dashboardCalendarSuggestions(OWNER);

    expect(suggestions.map((suggestion) => suggestion.id)).toEqual(["near"]);
  });

  it("spends the Calendar cap on near suggestions rather than on discarded ones", async () => {
    // Calendar suggestions arrive newest-created, not due-first, so a cap applied
    // before the horizon could hand back an empty tab while near ones waited.
    listCalendarSuggestedFollowups.mockResolvedValue([
      ...Array.from({ length: 5 }, (_, index) => ({ id: `far-${index}`, dueAt: inDays(60) })),
      { id: "near", dueAt: inDays(2) },
    ]);

    const suggestions = await dashboardCalendarSuggestions(OWNER);

    expect(suggestions.map((suggestion) => suggestion.id)).toEqual(["near"]);
  });

  it("keeps everything inside the horizon, including the last day", async () => {
    listSuggestedFollowupReviews.mockResolvedValue([
      { followup: { id: "today", dueAt: inDays(0) } },
      { followup: { id: "edge", dueAt: followupHorizonFrom(new Date()) } },
    ]);

    const reviews = await dashboardSuggestedFollowups(OWNER);

    expect(reviews.map((review) => review.followup.id)).toEqual(["today", "edge"]);
  });
});

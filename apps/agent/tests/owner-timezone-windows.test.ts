import type { GeneralActionWithContext } from "@tendnote/db/queries/general-actions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownerLocalDayStart } from "../agent/lib/owner-day";
import { asTestTool, parseToolInput } from "./test-tool";

/**
 * "Today" has to mean the owner's day, not the server's.
 *
 * The agent runs in UTC. A window computed from the server clock silently drops a
 * Pacific owner's whole evening — 6pm on the 4th in Los Angeles is already the 5th
 * in UTC — so "what's due today?" answered with tomorrow's ledger and left today's
 * reminders out of it. These pin the cutoff to the owner's midnight for the two
 * list tools and for the shared helper they both use.
 */
const mocks = vi.hoisted(() => ({
  listActiveFollowups: vi.fn(),
  listActiveGeneralActions: vi.fn(),
  listPausedGeneralActions: vi.fn(),
  listResolvedGeneralActions: vi.fn(),
  listGeneralActionAreas: vi.fn(),
  getOwnerTodayContext: vi.fn(),
}));

vi.mock("@tendnote/db/queries/followups", () => ({
  listActiveFollowups: mocks.listActiveFollowups,
}));
// `list_general_actions` reads the owner's Areas alongside the ledger. Unmocked
// that is a real query, so the suite passed only where a Postgres happened to be
// listening on the configured URL and failed in CI, where none is.
vi.mock("@tendnote/db/queries/general-action-areas", () => ({
  listGeneralActionAreas: mocks.listGeneralActionAreas,
}));
vi.mock("@tendnote/db/queries/general-actions", () => ({
  listActiveGeneralActions: mocks.listActiveGeneralActions,
  listPausedGeneralActions: mocks.listPausedGeneralActions,
  listResolvedGeneralActions: mocks.listResolvedGeneralActions,
}));
vi.mock("@tendnote/db/queries/today", () => ({
  getOwnerTodayContext: mocks.getOwnerTodayContext,
}));

const { default: rawFollowupsTool } = await import("../agent/tools/list_due_followups");
const { default: rawActionsTool } = await import("../agent/tools/list_general_actions");
const followupsTool = asTestTool(rawFollowupsTool);
const actionsTool = asTestTool(rawActionsTool);

const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;

/** Evening of 2026-07-04 in Los Angeles, which is already 2026-07-05 in UTC. */
const PACIFIC_EVENING = {
  localDate: "2026-07-04",
  timeZone: "America/Los_Angeles",
  now: new Date("2026-07-05T02:00:00.000Z"),
};

function action(overrides: Partial<GeneralActionWithContext>): GeneralActionWithContext {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ownerUserId: "owner-1",
    ownership: "member_owned",
    responsibilityHolderUserId: null,
    occurrenceVersion: 0,
    title: "Replace the fridge water filter",
    notes: null,
    links: [],
    status: "open",
    dueAt: null,
    deferUntil: null,
    sourceRecordId: null,
    areaId: null,
    scope: "private",
    householdId: null,
    assetHints: [],
    recurrence: null,
    createdByUserId: "owner-1",
    lastActorUserId: "owner-1",
    completedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    linkedPeople: [],
    sharedWithCount: 0,
    householdName: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOwnerTodayContext.mockResolvedValue(PACIFIC_EVENING);
  mocks.listActiveFollowups.mockResolvedValue([]);
  mocks.listActiveGeneralActions.mockResolvedValue([]);
  mocks.listResolvedGeneralActions.mockResolvedValue([]);
  mocks.listGeneralActionAreas.mockResolvedValue([]);
});

describe("ownerLocalDayStart", () => {
  it("anchors on the owner's midnight, not the server's", () => {
    // 2026-07-05T00:00 in Los Angeles is 07:00Z, not 00:00Z.
    expect(ownerLocalDayStart(PACIFIC_EVENING, 1).toISOString()).toBe("2026-07-05T07:00:00.000Z");
    expect(ownerLocalDayStart(PACIFIC_EVENING, 0).toISOString()).toBe("2026-07-04T07:00:00.000Z");
  });

  it("adds whole calendar days across a daylight-saving transition", () => {
    // Los Angeles leaves DST on 2026-11-01, so the seventh day out is UTC-8, not UTC-7.
    const beforeFallBack = {
      localDate: "2026-10-29",
      timeZone: "America/Los_Angeles",
      now: new Date("2026-10-29T12:00:00.000Z"),
    };
    expect(ownerLocalDayStart(beforeFallBack, 7).toISOString()).toBe("2026-11-05T08:00:00.000Z");
  });
});

describe("list_due_followups windows on the owner's day", () => {
  it("cuts 'today' off at the owner's next midnight", async () => {
    await followupsTool.execute(parseToolInput(followupsTool, { window: "today" }), ctx);

    expect(mocks.listActiveFollowups).toHaveBeenCalledWith(
      expect.objectContaining({ dueBefore: new Date("2026-07-05T07:00:00.000Z") }),
    );
  });

  it("cuts 'this_week' off seven owner-days out", async () => {
    await followupsTool.execute(parseToolInput(followupsTool, { window: "this_week" }), ctx);

    expect(mocks.listActiveFollowups).toHaveBeenCalledWith(
      expect.objectContaining({ dueBefore: new Date("2026-07-11T07:00:00.000Z") }),
    );
  });

  it("does not read the owner's day when no window is asked for", async () => {
    await followupsTool.execute(parseToolInput(followupsTool, {}), ctx);

    expect(mocks.getOwnerTodayContext).not.toHaveBeenCalled();
    expect(mocks.listActiveFollowups).toHaveBeenCalledWith(
      expect.objectContaining({ dueBefore: undefined }),
    );
  });
});

describe("list_general_actions windows on the owner's day", () => {
  it("keeps an action due on the owner's own evening inside 'today'", async () => {
    // 2026-07-04 21:00 Pacific = 2026-07-05 04:00Z. A server-day cutoff of
    // 2026-07-05T00:00Z would have dropped it.
    mocks.listActiveGeneralActions.mockResolvedValue([
      action({ dueAt: new Date("2026-07-05T04:00:00.000Z") }),
    ]);

    const result = await actionsTool.execute({ window: "today" }, ctx);

    expect(result.count).toBe(1);
  });

  it("does not read the owner's day for a ledger read with no window", async () => {
    await actionsTool.execute({ ledger: "resolved" }, ctx);

    expect(mocks.getOwnerTodayContext).not.toHaveBeenCalled();
  });

  it("does not call an action due tomorrow in the owner's zone overdue", async () => {
    mocks.listActiveGeneralActions.mockResolvedValue([
      action({ dueAt: new Date("2026-07-05T04:00:00.000Z") }),
    ]);

    const result = await actionsTool.execute({ window: "overdue" }, ctx);

    expect(result.count).toBe(0);
  });
});

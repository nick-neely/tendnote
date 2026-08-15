import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The date anchor the model works from.
 *
 * It used to be UTC, which put a Pacific owner asking Eve for "tomorrow" at 6pm on
 * a day they had not reached: every concrete ISO date Eve derived from it landed
 * one day early. The anchor now follows the owner's own zone, and the resolver is
 * fail-open — a turn without a date anchor is worse than one anchored on UTC, so
 * no missing owner and no projection failure may cost the turn its date.
 */
const { getOwnerTodayContext } = vi.hoisted(() => ({ getOwnerTodayContext: vi.fn() }));

vi.mock("@tendnote/db/queries/today", () => ({ getOwnerTodayContext }));

const { default: currentDate } = await import("../agent/instructions/current-date");

/** An authenticated human caller, the only kind that carries a resolvable zone. */
const ownerCtx = {
  session: { auth: { current: { principalId: "owner-1", principalType: "user" } } },
} as never;

async function markdown(ctx: unknown, now: Date): Promise<string> {
  vi.setSystemTime(now);
  const handler = currentDate.events["turn.started"] as (
    event: unknown,
    ctx: unknown,
  ) => Promise<{ markdown: string }>;
  return (await handler({}, ctx)).markdown;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

describe("the date anchor follows the owner's timezone", () => {
  it("names the owner's calendar day, not the server's", async () => {
    getOwnerTodayContext.mockResolvedValue({
      localDate: "2026-07-04",
      timeZone: "America/Los_Angeles",
      now: new Date("2026-07-05T02:00:00.000Z"),
    });

    // 7pm on the 4th in Los Angeles is already the 5th in UTC.
    const text = await markdown(ownerCtx, new Date("2026-07-05T02:00:00.000Z"));

    expect(text).toContain("2026-07-04");
    expect(text).toContain("Saturday, July 4, 2026");
    expect(text).toContain("America/Los_Angeles");
    expect(text).not.toContain("2026-07-05");
  });

  it("falls back to UTC when the owner's zone cannot be read", async () => {
    getOwnerTodayContext.mockRejectedValue(new Error("projection unavailable"));

    const text = await markdown(ownerCtx, new Date("2026-07-05T02:00:00.000Z"));

    expect(text).toContain("2026-07-05");
    expect(text).toContain("(UTC)");
  });

  it("falls back to UTC for a session with no authenticated owner", async () => {
    const text = await markdown(
      { session: { auth: { current: null } } },
      new Date("2026-07-05T02:00:00.000Z"),
    );

    expect(getOwnerTodayContext).not.toHaveBeenCalled();
    expect(text).toContain("2026-07-05");
    expect(text).toContain("(UTC)");
  });

  it("keeps the standing instruction to anchor every relative date on it", async () => {
    getOwnerTodayContext.mockResolvedValue({
      localDate: "2026-07-04",
      timeZone: "UTC",
      now: new Date("2026-07-04T12:00:00.000Z"),
    });

    const text = await markdown(ownerCtx, new Date("2026-07-04T12:00:00.000Z"));

    expect(text).toContain("You have no other knowledge of the current date");
    expect(text).toMatch(/ISO 8601/);
  });
});

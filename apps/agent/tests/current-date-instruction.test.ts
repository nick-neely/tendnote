import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
const { default: subagentCurrentDate } = await import(
  "../agent/subagents/relationship_strategist/instructions/current-date"
);

/** An authenticated human caller, the only kind that carries a resolvable zone. */
const ownerCtx = {
  session: { auth: { current: { principalId: "owner-1", principalType: "user" } } },
} as never;

/** The same owner, one level down: a turn the root delegated to a subagent. */
const delegatedCtx = {
  session: {
    auth: { current: { principalId: "owner-1", principalType: "user" } },
    parent: { sessionId: "root-session" },
  },
} as never;

type Anchor = { events: Record<string, unknown> };

async function markdownFrom(anchor: Anchor, ctx: unknown, now: Date): Promise<string> {
  vi.setSystemTime(now);
  const handler = anchor.events["turn.started"] as (
    event: unknown,
    ctx: unknown,
  ) => Promise<{ markdown: string }>;
  return (await handler({}, ctx)).markdown;
}

async function markdown(ctx: unknown, now: Date): Promise<string> {
  return markdownFrom(currentDate as Anchor, ctx, now);
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

  /**
   * A declared subagent inherits nothing - not the root's instructions, not this
   * anchor - so `relationship_strategist` was resolving "next week" with no idea what
   * week it was. Its own anchor uses the authenticated-caller rule instead of the
   * root's orientation rule, which refuses child sessions by design: the delegated
   * turn runs under the owner's own principal, the same id its tools scope reads by.
   */
  it("anchors a delegated subagent turn on the same owner's day", async () => {
    getOwnerTodayContext.mockResolvedValue({
      localDate: "2026-07-04",
      timeZone: "America/Los_Angeles",
      now: new Date("2026-07-05T02:00:00.000Z"),
    });

    const text = await markdownFrom(
      subagentCurrentDate as never,
      delegatedCtx,
      new Date("2026-07-05T02:00:00.000Z"),
    );

    expect(getOwnerTodayContext).toHaveBeenCalledWith({ ownerUserId: "owner-1" });
    expect(text).toContain("2026-07-04");
    expect(text).toContain("America/Los_Angeles");
  });

  it("still refuses a child session the Self Context orientation rule protects", async () => {
    // The root's own anchor keeps the stricter rule, so nothing here loosens the
    // exclusion that keeps stored facts out of a delegated session.
    const text = await markdown(delegatedCtx, new Date("2026-07-05T02:00:00.000Z"));

    expect(getOwnerTodayContext).not.toHaveBeenCalled();
    expect(text).toContain("(UTC)");
  });

  it("gives every declared subagent its own anchor", () => {
    const subagentsDir = join(process.cwd(), "agent/subagents");
    for (const subagent of readdirSync(subagentsDir)) {
      const source = readFileSync(
        join(subagentsDir, subagent, "instructions/current-date.ts"),
        "utf8",
      );
      expect(source, subagent).toContain("currentDateAnchor");
      expect(source, subagent).toContain("resolveAuthenticatedCaller");
    }
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

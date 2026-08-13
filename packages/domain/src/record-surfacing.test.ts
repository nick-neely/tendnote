import { describe, expect, it } from "vitest";
import { formatSurfacingDay, resolveRecordSurfacing } from "./record-surfacing";

const NOW = new Date(2026, 2, 14, 12);
const UPDATED_AT = new Date("2026-03-13T18:30:00.000Z");

describe("record surfacing", () => {
  it("gives overdue General Actions and Follow-Ups the same calm timing state and label", () => {
    const dueAt = new Date(2026, 2, 12);
    const common = {
      dueAt,
      householdName: null,
      ownerUserId: "owner-1",
      scope: "private" as const,
      sharedWithCount: 0,
      updatedAt: UPDATED_AT,
      viewerUserId: "owner-1",
    };

    const action = resolveRecordSurfacing(
      {
        ...common,
        kind: "general_action",
        deferUntil: null,
        status: "open",
      },
      NOW,
    );
    const followup = resolveRecordSurfacing(
      {
        ...common,
        kind: "followup",
        status: "open",
      },
      NOW,
    );

    expect(action).toEqual(followup);
    expect(action).toEqual({
      audienceLabel: "Only me",
      owned: true,
      revision: UPDATED_AT.toISOString(),
      state: "overdue",
      timingLabel: "Was due Mar 12",
    });
  });

  it("keeps General Action-only paused, deferred, and unscheduled states", () => {
    const common = {
      householdName: null,
      ownerUserId: "owner-1",
      scope: "private" as const,
      sharedWithCount: 0,
      updatedAt: UPDATED_AT,
      viewerUserId: "owner-1",
    };

    expect(
      resolveRecordSurfacing(
        {
          ...common,
          kind: "general_action",
          deferUntil: null,
          dueAt: new Date(2026, 2, 1),
          status: "paused",
        },
        NOW,
      ),
    ).toMatchObject({ state: "paused", timingLabel: "Paused" });
    expect(
      resolveRecordSurfacing(
        {
          ...common,
          kind: "general_action",
          deferUntil: new Date(2026, 2, 20),
          dueAt: null,
          status: "deferred",
        },
        NOW,
      ),
    ).toMatchObject({ state: "deferred", timingLabel: "Set aside until Mar 20" });
    expect(
      resolveRecordSurfacing(
        {
          ...common,
          kind: "general_action",
          deferUntil: null,
          dueAt: null,
          status: "open",
        },
        NOW,
      ),
    ).toMatchObject({ state: "unscheduled", timingLabel: "No date" });
  });

  it("names a selected-member or whole-household audience and derives ownership and revision", () => {
    expect(
      resolveRecordSurfacing(
        {
          kind: "followup",
          dueAt: new Date(2026, 2, 14),
          householdName: "Home",
          ownerUserId: "owner-1",
          scope: "shared",
          sharedWithCount: 2,
          status: "open",
          updatedAt: UPDATED_AT,
          viewerUserId: "member-1",
        },
        NOW,
      ),
    ).toEqual({
      audienceLabel: "Shared with 2 people",
      owned: false,
      revision: UPDATED_AT.toISOString(),
      state: "today",
      timingLabel: "Due today",
    });

    expect(
      resolveRecordSurfacing(
        {
          kind: "followup",
          dueAt: new Date(2026, 2, 20),
          householdName: "Home",
          ownerUserId: "owner-1",
          scope: "household",
          sharedWithCount: 0,
          status: "open",
          updatedAt: UPDATED_AT,
          viewerUserId: "owner-1",
        },
        NOW,
      ),
    ).toMatchObject({
      audienceLabel: "Whole household",
      state: "upcoming",
      timingLabel: "Due Mar 20",
    });
  });

  it("classifies a Saved Item bring-back date with the shared due vocabulary", () => {
    const common = {
      householdName: null,
      ownerUserId: "owner-1",
      scope: "private" as const,
      sharedWithCount: 0,
      status: "active" as const,
      updatedAt: UPDATED_AT,
      viewerUserId: "owner-1",
    };

    expect(
      resolveRecordSurfacing(
        {
          ...common,
          kind: "saved_item",
          bringBackAt: new Date(2026, 2, 12),
        },
        NOW,
      ),
    ).toMatchObject({ state: "overdue", timingLabel: "Was due Mar 12" });
    expect(
      resolveRecordSurfacing(
        {
          ...common,
          kind: "saved_item",
          bringBackAt: new Date(2026, 2, 14),
        },
        NOW,
      ),
    ).toMatchObject({ state: "today", timingLabel: "Due today" });
    expect(
      resolveRecordSurfacing(
        {
          ...common,
          kind: "saved_item",
          bringBackAt: new Date(2026, 2, 20),
        },
        NOW,
      ),
    ).toMatchObject({ state: "upcoming", timingLabel: "Due Mar 20" });
    expect(
      resolveRecordSurfacing(
        {
          ...common,
          kind: "saved_item",
          status: "archived",
          bringBackAt: new Date(2026, 2, 12),
        },
        NOW,
      ),
    ).toMatchObject({ state: "unscheduled", timingLabel: "No date" });
  });

  it("formats every surfaced day with a year only outside the current year", () => {
    expect(formatSurfacingDay(new Date(2026, 2, 14), NOW)).toBe("Mar 14");
    expect(formatSurfacingDay(new Date(2025, 2, 14), NOW)).toBe("Mar 14, 2025");
  });
});

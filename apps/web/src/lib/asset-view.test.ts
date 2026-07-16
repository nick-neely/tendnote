import type { AssetWithContext } from "@tendnote/db/queries/assets";
import { describe, expect, it } from "vitest";
import { toAssetView } from "@/lib/asset-view";

const NOW = new Date("2026-07-12T12:00:00");

function asset(overrides: Partial<AssetWithContext> = {}): AssetWithContext {
  return {
    id: "asset-1",
    ownerUserId: "owner-1",
    name: "Refrigerator water filter",
    kind: "appliance",
    status: "active",
    scope: "private",
    householdId: null,
    archivedAt: null,
    createdByUserId: "owner-1",
    lastActorUserId: "owner-1",
    createdAt: new Date("2026-07-01T00:00:00"),
    updatedAt: new Date("2026-07-01T00:00:00"),
    sharedWithCount: 0,
    sharedWithUserIds: [],
    householdName: null,
    ...overrides,
  };
}

describe("toAssetView", () => {
  it("maps an active private asset with a kind label and added date", () => {
    const view = toAssetView(asset(), { callerUserId: "owner-1", now: NOW });

    expect(view.kindLabel).toBe("Appliance");
    expect(view.archived).toBe(false);
    expect(view.owned).toBe(true);
    expect(view.visibilityLabel).toBe("Only me");
    expect(view.addedLabel).toBe("Added Jul 1");
    expect(view.archivedLabel).toBeNull();
  });

  it("labels a household asset with the household's name and non-ownership", () => {
    const view = toAssetView(
      asset({ scope: "household", householdId: "hh-1", householdName: "Home" }),
      { callerUserId: "member-2", now: NOW },
    );

    expect(view.owned).toBe(false);
    expect(view.visibilityLabel).toBe("Home");
  });

  it("labels a shared asset with its audience count", () => {
    const view = toAssetView(
      asset({ scope: "shared", householdId: "hh-1", sharedWithCount: 2, householdName: "Home" }),
      { callerUserId: "owner-1", now: NOW },
    );

    expect(view.visibilityLabel).toBe("Specific people · 2");
  });

  it("marks an archived asset with an archive date", () => {
    const view = toAssetView(
      asset({ status: "archived", archivedAt: new Date("2026-07-10T00:00:00") }),
      { callerUserId: "owner-1", now: NOW },
    );

    expect(view.archived).toBe(true);
    expect(view.archivedLabel).toBe("Archived Jul 10");
  });

  it("carries the year when a date falls outside the current one", () => {
    const view = toAssetView(asset({ createdAt: new Date("2025-12-20T00:00:00") }), {
      callerUserId: "owner-1",
      now: NOW,
    });

    expect(view.addedLabel).toBe("Added Dec 20, 2025");
  });
});

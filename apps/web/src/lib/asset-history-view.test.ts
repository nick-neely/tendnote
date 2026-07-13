import type { AssetHistoryEntry } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { toAssetHistoryEntryView } from "@/lib/asset-history-view";

const NOW = new Date("2026-07-12T12:00:00Z");

describe("toAssetHistoryEntryView", () => {
  it("labels the asset's own lifecycle moments plainly", () => {
    const entry: AssetHistoryEntry = {
      id: "asset-e1",
      type: "asset",
      at: new Date("2026-07-01T12:00:00Z"),
      event: "added",
    };
    const view = toAssetHistoryEntryView(entry, NOW);
    expect(view.label).toBe("Added");
    expect(view.detail).toBeNull();
    expect(view.actionId).toBeNull();
    expect(view.atLabel).toBe("Jul 1");
  });

  it("shows the year for entries from another year", () => {
    const view = toAssetHistoryEntryView(
      { id: "asset-e2", type: "asset", at: new Date("2025-03-14T12:00:00Z"), event: "archived" },
      NOW,
    );
    expect(view.label).toBe("Archived");
    expect(view.atLabel).toBe("Mar 14, 2025");
  });

  it("labels a reviewed memory as a detail with its name", () => {
    const view = toAssetHistoryEntryView(
      {
        id: "memory-m1",
        type: "memory",
        at: new Date("2026-07-02T12:00:00Z"),
        memoryId: "m1",
        label: "Filter size",
      },
      NOW,
    );
    expect(view.label).toBe("Detail added");
    expect(view.detail).toBe("Filter size");
  });

  it("labels a linked action's event and carries the deep-link id and title", () => {
    const view = toAssetHistoryEntryView(
      {
        id: "action-a1",
        type: "action",
        at: new Date("2026-07-03T12:00:00Z"),
        actionId: "action-1",
        actionTitle: "Replace the refrigerator water filter",
        event: "completed",
      },
      NOW,
    );
    expect(view.label).toBe("Completed");
    expect(view.detail).toBe("Replace the refrigerator water filter");
    expect(view.actionId).toBe("action-1");
  });
});

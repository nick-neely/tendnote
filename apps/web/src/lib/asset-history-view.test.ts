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
    expect(view.detailHref).toBeNull();
    expect(view.atLabel).toBe("Jul 1");
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
    expect(view.detailHref).toBeNull();
  });

  it("names captured evidence by its kind, attached — never confusable with a context link", () => {
    const view = toAssetHistoryEntryView(
      {
        id: "evidence-ev1",
        type: "evidence",
        at: new Date("2026-07-04T12:00:00Z"),
        evidenceId: "ev1",
        kind: "receipt",
        label: "Costco receipt",
      },
      NOW,
    );
    expect(view.label).toBe("Receipt attached");
    expect(view.detail).toBe("Costco receipt");

    const capturedLink = toAssetHistoryEntryView(
      {
        id: "evidence-ev2",
        type: "evidence",
        at: new Date("2026-07-04T12:00:00Z"),
        evidenceId: "ev2",
        kind: "link",
        label: "Filter subscription page",
      },
      NOW,
    );
    expect(capturedLink.label).toBe("Link attached");
  });

  it("reads an asset link as the same sentence the links section shows, from this side", () => {
    const outgoing = toAssetHistoryEntryView(
      {
        id: "asset-link-l1",
        type: "asset-link",
        at: new Date("2026-07-05T12:00:00Z"),
        linkId: "l1",
        otherAssetId: "asset-2",
        otherAssetName: "Refrigerator",
        relation: "fits",
        direction: "outgoing",
      },
      NOW,
    );
    expect(outgoing.label).toBe("Linked");
    expect(outgoing.detail).toBe("fits Refrigerator");
    expect(outgoing.detailHref).toBe("/assets/asset-2");

    const incoming = toAssetHistoryEntryView(
      {
        id: "asset-link-l2",
        type: "asset-link",
        at: new Date("2026-07-05T12:00:00Z"),
        linkId: "l2",
        otherAssetId: "asset-3",
        otherAssetName: "Water filter",
        relation: "fits",
        direction: "incoming",
      },
      NOW,
    );
    expect(incoming.detail).toBe("Water filter fits this");
  });

  it("reads a person link as a sentence that hops to the person", () => {
    const view = toAssetHistoryEntryView(
      {
        id: "person-link-p1",
        type: "person-link",
        at: new Date("2026-07-06T12:00:00Z"),
        linkId: "p1",
        personId: "person-1",
        displayName: "Alex Morgan",
        relation: "recommended",
      },
      NOW,
    );
    expect(view.label).toBe("Linked");
    expect(view.detail).toBe("Alex Morgan recommended it");
    expect(view.detailHref).toBe("/people/person-1");
  });

  it("labels a linked action's event and carries the deep link and title", () => {
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
    expect(view.detailHref).toBe("/actions#action-action-1");
  });
});

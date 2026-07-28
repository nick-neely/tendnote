import { describe, expect, it, vi } from "vitest";
import { createAssetBrowser } from "./browse";
import type { AssetBrowseRow, AssetBrowseStore } from "./browse-types";

const row = (name: string): AssetBrowseRow => ({
  asset: {
    id: name.toLowerCase(),
    ownerUserId: "owner",
    name,
    kind: "item",
    status: "active",
    scope: "private",
    householdId: null,
    archivedAt: null,
    createdByUserId: "owner",
    lastActorUserId: "owner",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  },
  needsReview: false,
  nextDueAction: null,
});

describe("asset browser", () => {
  it("returns a bounded page and a next offset without leaking the lookahead row", async () => {
    const rows = [row("Alpha"), row("Bravo"), row("Charlie")];
    const store: AssetBrowseStore = {
      listAssetBrowseRows: vi.fn(async (input) =>
        rows.slice(input.offset, input.offset + input.limit),
      ),
      countPendingAssetReviews: vi.fn(async () => 4),
    };

    const page = await createAssetBrowser(store).browseAssets({
      callerUserId: "owner",
      pageSize: 2,
    });

    expect(page.items.map((item) => item.asset.name)).toEqual(["Alpha", "Bravo"]);
    expect(page.nextOffset).toBe(2);
    expect(page.reviewCount).toBe(4);
    expect(store.listAssetBrowseRows).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3, offset: 0, sort: "name" }),
    );
  });
});

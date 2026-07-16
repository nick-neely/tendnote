import { describe, expect, it, vi } from "vitest";
import {
  loadReviewQueue,
  type ReviewQueueItem,
  resolveReviewQueueItem,
  updateReviewQueueItem,
} from "./review-queue";

function item(family: ReviewQueueItem["family"], id: string): ReviewQueueItem {
  if (family === "suggested-memory") {
    return { family, id, review: { memory: { id } } } as ReviewQueueItem;
  }
  if (family === "suggested-general-action") {
    return { family, id, review: { action: { id } } } as ReviewQueueItem;
  }
  return { family, id, review: { groupId: id } } as ReviewQueueItem;
}

describe("Review Queue", () => {
  it("collects owner-scoped families into one globally bounded, stable order", async () => {
    const loadMemories = vi
      .fn()
      .mockResolvedValue([
        item("suggested-memory", "memory-first"),
        item("suggested-memory", "memory-second"),
      ]);
    const loadGeneralActions = vi
      .fn()
      .mockResolvedValue([
        item("suggested-general-action", "action-first"),
        item("suggested-general-action", "action-second"),
      ]);
    const loadAssetGroups = vi.fn().mockResolvedValue([item("asset-review-group", "asset-first")]);

    const queue = await loadReviewQueue(
      { ownerUserId: "owner-1", limit: 4 },
      { loadMemories, loadGeneralActions, loadAssetGroups },
    );

    expect(loadMemories).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 4 });
    expect(loadGeneralActions).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 4 });
    expect(loadAssetGroups).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 4 });
    expect(queue.items.map(({ family, id }) => `${family}:${id}`)).toEqual([
      "suggested-memory:memory-first",
      "suggested-memory:memory-second",
      "suggested-general-action:action-first",
      "suggested-general-action:action-second",
    ]);
    expect(queue.count).toBe(4);
    expect(queue.failures).toEqual([]);
  });

  it("keeps successful families when one family fails", async () => {
    const queue = await loadReviewQueue(
      { ownerUserId: "owner-1", limit: 6 },
      {
        loadMemories: vi.fn().mockRejectedValue(new Error("memory store unavailable")),
        loadGeneralActions: vi
          .fn()
          .mockResolvedValue([item("suggested-general-action", "action-1")]),
        loadAssetGroups: vi.fn().mockResolvedValue([item("asset-review-group", "group-1")]),
      },
    );

    expect(queue.items.map(({ id }) => id)).toEqual(["action-1", "group-1"]);
    expect(queue.count).toBe(2);
    expect(queue.failures).toEqual(["suggested-memory"]);
  });

  it("counts one queue entry per grouped Asset review and returns an empty collection", async () => {
    const dependencies = {
      loadMemories: vi.fn().mockResolvedValue([]),
      loadGeneralActions: vi.fn().mockResolvedValue([]),
      loadAssetGroups: vi.fn().mockResolvedValue([]),
    };
    const empty = await loadReviewQueue({ ownerUserId: "owner-1", limit: 6 }, dependencies);
    expect(empty).toEqual({ items: [], count: 0, failures: [] });

    dependencies.loadAssetGroups.mockResolvedValueOnce([
      item("asset-review-group", "group-with-many-members"),
    ]);
    const grouped = await loadReviewQueue({ ownerUserId: "owner-1", limit: 6 }, dependencies);
    expect(grouped.count).toBe(1);
  });

  it("updates and resolves only the matching discriminated identity", () => {
    const memory = item("suggested-memory", "shared-id");
    const action = item("suggested-general-action", "shared-id") as Extract<
      ReviewQueueItem,
      { family: "suggested-general-action" }
    >;
    const asset = item("asset-review-group", "asset-1");
    const queue = { items: [memory, action, asset], count: 3, failures: [] };
    const updatedAction = {
      ...action,
      review: { ...action.review, action: { ...action.review.action, title: "Updated" } },
    } as ReviewQueueItem;

    const updated = updateReviewQueueItem(queue, updatedAction);
    expect(updated.items[0]).toBe(memory);
    expect(updated.items[1]).toBe(updatedAction);
    expect(updated.items[2]).toBe(asset);

    const resolved = resolveReviewQueueItem(updated, {
      family: "suggested-memory",
      id: "shared-id",
    });
    expect(resolved.items).toEqual([updatedAction, asset]);
    expect(resolved.count).toBe(2);
  });
});

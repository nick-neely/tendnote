import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMemories: vi.fn(),
  listActions: vi.fn(),
  listAssets: vi.fn(),
  memoryView: vi.fn((result) => ({ memory: { id: result.memory.id } })),
  actionView: vi.fn((result) => ({ action: { id: result.action.id } })),
  assetView: vi.fn((result) => ({ groupId: result.group.id })),
}));

vi.mock("@tendnote/db/queries/memories", () => ({
  listSuggestedMemoryReviews: mocks.listMemories,
}));
vi.mock("@tendnote/db/queries/general-actions", () => ({
  listSuggestedGeneralActionReviews: mocks.listActions,
}));
vi.mock("@tendnote/db/queries/assets", () => ({ listAssetReviewGroups: mocks.listAssets }));
vi.mock("@/lib/suggested-memory-review-view", () => ({
  toSuggestedMemoryReviewView: mocks.memoryView,
}));
vi.mock("@/lib/suggested-general-action-review-view", () => ({
  toSuggestedGeneralActionReviewView: mocks.actionView,
}));
vi.mock("@/lib/asset-review-origin", () => ({
  toAssetReviewGroupViewWithOrigin: mocks.assetView,
}));

import { loadOwnerReviewQueue } from "./review-queue.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listMemories.mockResolvedValue([]);
  mocks.listActions.mockResolvedValue([]);
  mocks.listAssets.mockResolvedValue([]);
});

describe("owner Review Queue adapter", () => {
  it("loads and shapes every family through one owner-scoped interface", async () => {
    mocks.listMemories.mockResolvedValue([
      { memory: { id: "memory-1", createdAt: new Date("2026-07-14T12:00:00Z") } },
    ]);
    mocks.listActions.mockResolvedValue([
      { action: { id: "action-1", createdAt: new Date("2026-07-16T12:00:00Z") } },
    ]);
    mocks.listAssets.mockResolvedValue([
      { group: { id: "group-1", createdAt: new Date("2026-07-15T12:00:00Z") } },
    ]);

    const queue = await loadOwnerReviewQueue("owner-1");

    expect(mocks.listMemories).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 6 });
    expect(mocks.listActions).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 6 });
    expect(mocks.listAssets).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 6 });
    expect(queue.items.map(({ family, id }) => `${family}:${id}`)).toEqual([
      "suggested-memory:memory-1",
      "suggested-general-action:action-1",
      "asset-review-group:group-1",
    ]);
  });

  it("preserves successful query families when another query rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.listMemories.mockRejectedValue(new Error("unavailable"));
    mocks.listAssets.mockResolvedValue([
      { group: { id: "group-1", createdAt: new Date("2026-07-15T12:00:00Z") } },
    ]);

    const queue = await loadOwnerReviewQueue("owner-1");

    expect(queue.items.map(({ id }) => id)).toEqual(["group-1"]);
    expect(queue.failures).toEqual(["suggested-memory"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMemories: vi.fn(),
  listActions: vi.fn(),
  listAssets: vi.fn(),
  listSources: vi.fn(),
  listContextFacts: vi.fn(),
  requireAdmittedOwner: vi.fn(),
  memoryView: vi.fn((result) => ({ memory: { id: result.memory.id } })),
  actionView: vi.fn((result) => ({ action: { id: result.action.id } })),
  assetView: vi.fn((result) => ({ groupId: result.group.id })),
  sourceView: vi.fn((result) => ({ sourceRecord: { id: result.sourceRecord.id } })),
  contextFactView: vi.fn((result) => ({ fact: { id: result.fact.id } })),
}));

vi.mock("@tendnote/db/queries/memories", () => ({
  listSuggestedMemoryReviews: mocks.listMemories,
}));
vi.mock("@tendnote/db/queries/general-actions", () => ({
  listSuggestedGeneralActionReviews: mocks.listActions,
}));
vi.mock("@tendnote/db/queries/assets", () => ({ listAssetReviewGroups: mocks.listAssets }));
vi.mock("@tendnote/db/queries/source-records", () => ({
  listSourceRecordReviews: mocks.listSources,
}));
vi.mock("@tendnote/db/queries/context-facts", () => ({
  listSuggestedContextFactReviews: mocks.listContextFacts,
}));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwner: mocks.requireAdmittedOwner,
}));
vi.mock("@/lib/suggested-memory-review-view", () => ({
  toSuggestedMemoryReviewView: mocks.memoryView,
}));
vi.mock("@/lib/suggested-general-action-review-view", () => ({
  toSuggestedGeneralActionReviewView: mocks.actionView,
}));
vi.mock("@/lib/asset-review-origin", () => ({
  toAssetReviewGroupViewWithOrigin: mocks.assetView,
}));
vi.mock("@/lib/source-record-review-view", () => ({
  toSourceRecordReviewView: mocks.sourceView,
}));
vi.mock("@/lib/suggested-context-fact-review-view", () => ({
  toSuggestedContextFactReviewView: mocks.contextFactView,
}));

import { loadOwnerReviewQueue, loadOwnerReviewQueueFamily } from "./review-queue.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listMemories.mockResolvedValue([]);
  mocks.listActions.mockResolvedValue([]);
  mocks.listAssets.mockResolvedValue([]);
  mocks.listSources.mockResolvedValue([]);
  mocks.listContextFacts.mockResolvedValue([]);
  mocks.requireAdmittedOwner.mockResolvedValue("owner-1");
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
    mocks.listSources.mockResolvedValue([
      {
        sourceRecord: { id: "source-1" },
        unresolvedMentions: [{ id: "mention-1", mentionText: "Maya" }],
      },
    ]);
    mocks.listContextFacts.mockResolvedValue([{ fact: { id: "context-1" } }]);

    const queue = await loadOwnerReviewQueue("owner-1");

    expect(mocks.listMemories).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 6 });
    expect(mocks.listActions).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 6 });
    expect(mocks.listAssets).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 6 });
    expect(mocks.listSources).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 6 });
    expect(mocks.listContextFacts).toHaveBeenCalledWith(
      { callerUserId: "owner-1" },
      expect.any(Function),
    );
    expect(queue.items.map(({ family, id }) => `${family}:${id}`)).toEqual([
      "suggested-memory:memory-1",
      "suggested-general-action:action-1",
      "asset-review-group:group-1",
      "source-record:source-1",
      "suggested-context-fact:context-1",
    ]);
  });

  it("names the Context Fact caller without reading the request", async () => {
    mocks.listContextFacts.mockResolvedValue([{ fact: { id: "context-1" } }]);

    // Family loads run inside a `"use cache"` body, where `headers()` throws.
    // Re-deriving the caller from the session there does not tighten the gate -
    // it makes every load fail closed and drops Self Context out of Review.
    const result = await loadOwnerReviewQueueFamily("owner-1", "suggested-context-fact");

    expect(result.unavailable).toBe(false);
    expect(mocks.requireAdmittedOwner).not.toHaveBeenCalled();
    const resolveVerifiedCaller = mocks.listContextFacts.mock.calls.at(0)?.at(1);
    await expect(resolveVerifiedCaller()).resolves.toBe("owner-1");
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

  it("streams a family without waiting for an unavailable sibling", async () => {
    mocks.listMemories.mockResolvedValue([
      { memory: { id: "memory-1", createdAt: new Date("2026-07-14T12:00:00Z") } },
    ]);
    mocks.listActions.mockRejectedValue(new Error("unavailable"));

    await expect(loadOwnerReviewQueueFamily("owner-1", "suggested-memory")).resolves.toMatchObject({
      family: "suggested-memory",
      items: [{ family: "suggested-memory", id: "memory-1" }],
      unavailable: false,
    });
    await expect(
      loadOwnerReviewQueueFamily("owner-1", "suggested-general-action"),
    ).resolves.toEqual({
      family: "suggested-general-action",
      items: [],
      unavailable: true,
    });
  });
});

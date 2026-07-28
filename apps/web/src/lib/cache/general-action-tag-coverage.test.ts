import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cacheLife, cacheTag } = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheLife, cacheTag }));
vi.mock("@tendnote/db/queries/general-actions", () => ({
  listActiveGeneralActions: vi.fn().mockResolvedValue([
    {
      id: "action-1",
      ownerUserId: "owner-1",
      status: "open",
      dueAt: null,
      deferUntil: null,
    },
  ]),
  listPausedGeneralActions: vi.fn(),
  listResolvedGeneralActions: vi.fn(),
}));
vi.mock("@tendnote/db/queries/assets", () => ({
  listLinkedAssetsForGeneralActions: vi.fn().mockResolvedValue({}),
}));
vi.mock("@tendnote/db/queries/general-action-areas", () => ({
  listGeneralActionAreas: vi.fn(),
}));
vi.mock("@tendnote/db/queries/reminders", () => ({
  listReminderSchedulesForOwner: vi.fn(),
}));
vi.mock("@tendnote/db/queries/today", () => ({
  getTodayShortlist: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/general-action-view", () => ({
  toGeneralActionLinkedAssetView: vi.fn(),
  toGeneralActionView: vi.fn((action) => action),
}));
vi.mock("@/lib/review-queue.server", () => ({
  loadOwnerReviewQueueFamily: vi.fn().mockResolvedValue([]),
}));

import { getCachedActionTodayViews } from "./action-views";
import { tagsForAffectedScope } from "./reconcile-affected-scopes";
import { getCachedReviewQueueFamily, getCachedTodayShortlist } from "./today-review-views";

describe("General Action affected-scope tag coverage", () => {
  beforeEach(() => {
    cacheLife.mockClear();
    cacheTag.mockClear();
  });

  it("maps every General Action scope to a tag attached by a cache read", async () => {
    await getCachedActionTodayViews({
      ownerUserId: "owner-1",
      now: new Date("2026-07-27T12:00:00Z"),
    });
    await getCachedTodayShortlist({
      ownerUserId: "owner-1",
      localDate: "2026-07-27",
      timeZone: "America/Chicago",
      now: new Date("2026-07-27T12:00:00Z"),
    });
    await getCachedReviewQueueFamily("owner-1", "suggested-general-action");

    const attachedTags = new Set(cacheTag.mock.calls.flat());
    const producibleScopes: AffectedScope[] = [
      {
        kind: "viewer-collection",
        collection: "general-actions",
        viewerUserId: "owner-1",
      },
      {
        kind: "viewer-entity",
        entity: "general-action",
        entityId: "action-1",
        viewerUserId: "owner-1",
      },
      { kind: "owner-collection", collection: "today", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
    ];

    for (const scope of producibleScopes) {
      for (const tag of tagsForAffectedScope(scope)) {
        expect(attachedTags, `read coverage for ${JSON.stringify(scope)}`).toContain(tag);
      }
    }
  });
});

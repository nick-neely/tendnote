import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cacheLife, cacheTag } = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheLife, cacheTag }));
vi.mock("@tendnote/db/queries/assets", () => ({
  browseAssets: vi.fn().mockResolvedValue({
    items: [{ asset: { id: "asset-1", householdId: "household-1" } }],
    nextOffset: null,
    reviewCount: 0,
  }),
  getAsset: vi.fn().mockResolvedValue({ id: "asset-1" }),
  listLinkedAssetsForGeneralActions: vi.fn().mockResolvedValue({
    "action-1": [{ asset: { id: "linked-asset-1" } }],
  }),
}));
vi.mock("@tendnote/db/queries/briefs", () => ({
  getCurrentBrief: vi.fn().mockResolvedValue({ id: "brief-1" }),
}));
vi.mock("@tendnote/db/queries/general-action-areas", () => ({
  listGeneralActionAreas: vi.fn().mockResolvedValue([]),
}));
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
  listPausedGeneralActions: vi.fn().mockResolvedValue([]),
  listResolvedGeneralActions: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tendnote/db/queries/people", () => ({
  getPersonDetailCoreView: vi.fn().mockResolvedValue({ id: "person-1" }),
  listPeopleProductView: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tendnote/db/queries/reminders", () => ({
  listReminderSchedulesForOwner: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tendnote/db/queries/saved-items", () => ({
  listSavedItems: vi.fn().mockResolvedValue([{ id: "saved-item-1", householdId: "household-1" }]),
}));
vi.mock("@tendnote/db/queries/today", () => ({
  getTodayShortlist: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/asset-view", () => ({
  toAssetBrowseView: vi.fn((value) => value),
  toAssetView: vi.fn((value) => value),
}));
vi.mock("@/lib/brief-view", () => ({
  toBriefView: vi.fn((value) => value),
}));
vi.mock("@/lib/general-action-area-view", () => ({
  toGeneralActionAreaView: vi.fn((value) => value),
}));
vi.mock("@/lib/general-action-view", () => ({
  toGeneralActionLinkedAssetView: vi.fn((value) => value),
  toGeneralActionView: vi.fn((value) => value),
}));
vi.mock("@/lib/reminder-schedule-view", () => ({
  toReminderScheduleView: vi.fn((value) => value),
}));
vi.mock("@/lib/review-queue.server", () => ({
  loadOwnerReviewQueueFamily: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/saved-item-view", () => ({
  toSavedItemView: vi.fn((value) => value),
}));

import { getCachedActionLedgerViews, getCachedActionTodayViews } from "./action-views";
import { tagsForAffectedScope } from "./affected-scope-tags";
import {
  getCachedActiveSavedItemViews,
  getCachedAssetCoreView,
  getCachedDefaultAssetViews,
} from "./asset-views";
import { getCachedCurrentBriefView } from "./brief-views";
import { getCachedPeopleList, getCachedPersonDetailCore } from "./people-views";
import { getCachedReviewQueueFamily, getCachedTodayShortlist } from "./today-review-views";

const NOW = new Date("2026-07-28T12:00:00Z");

const everyScope: AffectedScope[] = [
  { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "assets", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "briefs", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "people", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "saved-items", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "today", ownerUserId: "owner-1" },
  {
    kind: "viewer-collection",
    collection: "assets",
    viewerUserId: "owner-1",
  },
  {
    kind: "viewer-collection",
    collection: "general-actions",
    viewerUserId: "owner-1",
  },
  {
    kind: "viewer-collection",
    collection: "saved-items",
    viewerUserId: "owner-1",
  },
  {
    kind: "viewer-entity",
    entity: "asset",
    entityId: "asset-1",
    viewerUserId: "owner-1",
  },
  {
    kind: "viewer-entity",
    entity: "general-action",
    entityId: "action-1",
    viewerUserId: "owner-1",
  },
  {
    kind: "viewer-entity",
    entity: "person",
    entityId: "person-1",
    viewerUserId: "owner-1",
  },
  {
    kind: "viewer-entity",
    entity: "saved-item",
    entityId: "saved-item-1",
    viewerUserId: "owner-1",
  },
  { kind: "visible-entity", entity: "asset", entityId: "asset-1" },
  { kind: "visible-entity", entity: "person", entityId: "person-1" },
  { kind: "visible-entity", entity: "saved-item", entityId: "saved-item-1" },
  {
    kind: "household-collection",
    collection: "assets",
    householdId: "household-1",
  },
  {
    kind: "household-collection",
    collection: "saved-items",
    householdId: "household-1",
  },
  { kind: "linked-entity", entity: "asset", entityId: "linked-asset-1" },
];

describe("affected-scope tag coverage", () => {
  beforeEach(() => {
    cacheLife.mockClear();
    cacheTag.mockClear();
  });

  it("attaches every tag the closed scope union can produce to a cache read", async () => {
    await Promise.all([
      getCachedActionTodayViews({ ownerUserId: "owner-1", now: NOW }),
      getCachedActionLedgerViews({ ownerUserId: "owner-1", now: NOW, resolvedLimit: 20 }),
      getCachedDefaultAssetViews({ callerUserId: "owner-1", now: NOW }),
      getCachedAssetCoreView({ callerUserId: "owner-1", assetId: "asset-1", now: NOW }),
      getCachedActiveSavedItemViews({ callerUserId: "owner-1", now: NOW }),
      getCachedCurrentBriefView({
        ownerUserId: "owner-1",
        cadence: "daily",
        localDate: "2026-07-28",
      }),
      getCachedPeopleList({ ownerUserId: "owner-1", limit: 50 }),
      getCachedPersonDetailCore({ ownerUserId: "owner-1", personId: "person-1" }),
      getCachedTodayShortlist({
        ownerUserId: "owner-1",
        localDate: "2026-07-28",
        timeZone: "America/Chicago",
        now: NOW,
      }),
      getCachedReviewQueueFamily("owner-1", "suggested-general-action"),
    ]);

    const attachedTags = new Set(cacheTag.mock.calls.flat());
    for (const scope of everyScope) {
      const tags = tagsForAffectedScope(scope);
      expect(tags, `tags for ${JSON.stringify(scope)}`).not.toHaveLength(0);
      for (const tag of tags) {
        expect(attachedTags, `read coverage for ${JSON.stringify(scope)}`).toContain(tag);
      }
    }
  });

  it("keeps the Context Fact projection tags distinct and owner-scoped", () => {
    expect(
      tagsForAffectedScope({
        kind: "owner-collection",
        collection: "context-facts",
        ownerUserId: "owner-1",
      }),
    ).toEqual(["context-facts:owner:owner-1"]);
    expect(
      tagsForAffectedScope({
        kind: "owner-collection",
        collection: "orientation",
        ownerUserId: "owner-1",
      }),
    ).toEqual(["orientation:owner:owner-1"]);
    expect(
      tagsForAffectedScope({
        kind: "owner-collection",
        collection: "global-recall",
        ownerUserId: "owner-1",
      }),
    ).toEqual(["global-recall:owner:owner-1"]);
  });
});

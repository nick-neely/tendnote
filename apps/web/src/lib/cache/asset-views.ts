import { browseAssets, getAsset } from "@tendnote/db/queries/assets";
import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import { listSavedItems } from "@tendnote/db/queries/saved-items";
import { cacheLife, cacheTag } from "next/cache";
import { toAssetBrowseView, toAssetView } from "@/lib/asset-view";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";
import { toSavedItemView } from "@/lib/saved-item-view";
import {
  tagForAffectedScope,
  tagsForAffectedScope,
  tagsForAffectedScopes,
} from "./affected-scope-tags";
import { cacheProfiles } from "./cache-profiles";

const ASSET_REFRESH_MS = 30_000;

/** Cache identity and tags for bounded caller-visible Asset and Saved Item views. */
export const assetCacheContract = {
  assetCollection(callerUserId: string) {
    return tagsForAffectedScope({
      kind: "viewer-collection",
      collection: "assets",
      viewerUserId: callerUserId,
    });
  },
  assetEntity(callerUserId: string, assetId: string) {
    return tagForAffectedScope({
      kind: "viewer-entity",
      entity: "asset",
      entityId: assetId,
      viewerUserId: callerUserId,
    });
  },
  /**
   * A record identity can be invalidated without knowing every eligible viewer.
   * It never participates in cache identity, so it cannot widen a read.
   */
  visibleAssetEntity(assetId: string) {
    return tagForAffectedScope({
      kind: "visible-entity",
      entity: "asset",
      entityId: assetId,
    });
  },
  /** A household audience may change its bounded default ledger together. */
  householdAssetCollection(householdId: string) {
    return tagForAffectedScope({
      kind: "household-collection",
      collection: "assets",
      householdId,
    });
  },
  savedItemCollection(callerUserId: string) {
    return tagsForAffectedScope({
      kind: "viewer-collection",
      collection: "saved-items",
      viewerUserId: callerUserId,
    });
  },
  savedItemEntity(callerUserId: string, savedItemId: string) {
    return tagForAffectedScope({
      kind: "viewer-entity",
      entity: "saved-item",
      entityId: savedItemId,
      viewerUserId: callerUserId,
    });
  },
  visibleSavedItemEntity(savedItemId: string) {
    return tagForAffectedScope({
      kind: "visible-entity",
      entity: "saved-item",
      entityId: savedItemId,
    });
  },
  householdSavedItemCollection(householdId: string) {
    return tagForAffectedScope({
      kind: "household-collection",
      collection: "saved-items",
      householdId,
    });
  },
};

function refreshBucket(now: Date) {
  return Math.floor(now.getTime() / ASSET_REFRESH_MS) * ASSET_REFRESH_MS;
}

/** The bounded default Assets ledger; searches, filters, and later pages stay uncached. */
export async function getCachedDefaultAssetViews(input: { callerUserId: string; now: Date }) {
  return cachedDefaultAssetViews(input.callerUserId, refreshBucket(input.now));
}

/** The visible Asset core; independently scoped children deliberately are not included. */
export async function getCachedAssetCoreView(input: {
  assetId: string;
  callerUserId: string;
  now: Date;
}) {
  return cachedAssetCoreView(input.callerUserId, input.assetId, refreshBucket(input.now));
}

/** The bounded default active Saved Items ledger; archived history loads only on request. */
export async function getCachedActiveSavedItemViews(input: { callerUserId: string; now: Date }) {
  return cachedActiveSavedItemViews(input.callerUserId, refreshBucket(input.now));
}

async function cachedDefaultAssetViews(callerUserId: string, refreshedAt: number) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...assetCacheContract.assetCollection(callerUserId));
  const page = await browseAssets({ callerUserId, statuses: ["active"] });
  const now = new Date(refreshedAt);
  return {
    assets: page.items.map((item) => {
      cacheTag(assetCacheContract.assetEntity(callerUserId, item.asset.id));
      cacheTag(assetCacheContract.visibleAssetEntity(item.asset.id));
      if (item.asset.householdId) {
        cacheTag(assetCacheContract.householdAssetCollection(item.asset.householdId));
      }
      return toAssetBrowseView(item, { callerUserId, now });
    }),
    nextOffset: page.nextOffset,
    reviewCount: page.reviewCount,
  };
}

async function cachedAssetCoreView(callerUserId: string, assetId: string, refreshedAt: number) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...assetCacheContract.assetCollection(callerUserId));
  cacheTag(assetCacheContract.assetEntity(callerUserId, assetId));
  cacheTag(assetCacheContract.visibleAssetEntity(assetId));
  const asset = await getAsset({ callerUserId, assetId });
  return asset ? toAssetView(asset, { callerUserId, now: new Date(refreshedAt) }) : null;
}

async function cachedActiveSavedItemViews(callerUserId: string, refreshedAt: number) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(
    ...tagsForAffectedScopes([
      {
        kind: "viewer-collection",
        collection: "saved-items",
        viewerUserId: callerUserId,
      },
      { kind: "owner-collection", collection: "account", ownerUserId: callerUserId },
    ] satisfies AffectedScope[]),
  );
  const [items, schedules] = await Promise.all([
    listSavedItems({ callerUserId, includeArchived: false }),
    listReminderSchedulesForOwner({ ownerUserId: callerUserId }),
  ]);
  const scheduleByItemId = new Map(
    schedules
      .filter((schedule) => schedule.recordKind === "saved_item")
      .map((schedule) => [schedule.recordId, schedule]),
  );
  const now = new Date(refreshedAt);
  return items.map((item) => {
    cacheTag(assetCacheContract.savedItemEntity(callerUserId, item.id));
    cacheTag(assetCacheContract.visibleSavedItemEntity(item.id));
    if (item.householdId) {
      cacheTag(assetCacheContract.householdSavedItemCollection(item.householdId));
    }
    const schedule = scheduleByItemId.get(item.id);
    return toSavedItemView(
      item,
      now,
      schedule ? toReminderScheduleView(schedule, "instant") : null,
    );
  });
}

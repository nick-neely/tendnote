import { browseAssets, getAsset } from "@tendnote/db/queries/assets";
import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import { listSavedItems } from "@tendnote/db/queries/saved-items";
import { cacheLife, cacheTag } from "next/cache";
import { toAssetBrowseView, toAssetView } from "@/lib/asset-view";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";
import { toSavedItemView } from "@/lib/saved-item-view";
import { cacheProfiles } from "./cache-profiles";

const ASSET_REFRESH_MS = 30_000;

/** Cache identity and tags for bounded caller-visible Asset and Saved Item views. */
export const assetCacheContract = {
  assetCollection(callerUserId: string) {
    return [`asset:viewer:${callerUserId}`, `asset:viewer:${callerUserId}:collection`] as const;
  },
  assetEntity(callerUserId: string, assetId: string) {
    return `asset:viewer:${callerUserId}:asset:${assetId}`;
  },
  /**
   * A record identity can be invalidated without knowing every eligible viewer.
   * It never participates in cache identity, so it cannot widen a read.
   */
  visibleAssetEntity(assetId: string) {
    return `asset:visible:asset:${assetId}`;
  },
  /** A household audience may change its bounded default ledger together. */
  householdAssetCollection(householdId: string) {
    return `asset:household:${householdId}:collection`;
  },
  savedItemCollection(callerUserId: string) {
    return [
      `saved-item:viewer:${callerUserId}`,
      `saved-item:viewer:${callerUserId}:collection`,
    ] as const;
  },
  savedItemEntity(callerUserId: string, savedItemId: string) {
    return `saved-item:viewer:${callerUserId}:item:${savedItemId}`;
  },
  visibleSavedItemEntity(savedItemId: string) {
    return `saved-item:visible:item:${savedItemId}`;
  },
  householdSavedItemCollection(householdId: string) {
    return `saved-item:household:${householdId}:collection`;
  },
  savedItemReminders(callerUserId: string) {
    return `saved-item:viewer:${callerUserId}:reminders`;
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
  cacheTag(...assetCacheContract.savedItemCollection(callerUserId));
  cacheTag(assetCacheContract.savedItemReminders(callerUserId));
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

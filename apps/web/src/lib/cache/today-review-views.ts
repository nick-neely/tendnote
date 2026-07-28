import { getTodayShortlist } from "@tendnote/db/queries/today";
import { cacheLife, cacheTag } from "next/cache";
import type { ReviewQueueFamily } from "@/lib/review-queue";
import { loadOwnerReviewQueueFamily } from "@/lib/review-queue.server";
import { tagsForAffectedScope } from "./affected-scope-tags";
import { cacheProfiles } from "./cache-profiles";

export const todayReviewCacheContract = {
  todayOwnerTags(ownerUserId: string) {
    return tagsForAffectedScope({
      kind: "owner-collection",
      collection: "today",
      ownerUserId,
    });
  },
  today(input: { ownerUserId: string }) {
    return {
      tags: todayReviewCacheContract.todayOwnerTags(input.ownerUserId),
    };
  },
  review(input: { ownerUserId: string }) {
    return {
      tags: tagsForAffectedScope({
        kind: "owner-collection",
        collection: "review",
        ownerUserId: input.ownerUserId,
      }),
    };
  },
};

const TODAY_REFRESH_MS = 30_000;

function todayRefreshBucket(now: Date): number {
  return Math.floor(now.getTime() / TODAY_REFRESH_MS) * TODAY_REFRESH_MS;
}

export async function getCachedTodayShortlist(input: {
  ownerUserId: string;
  localDate: string;
  timeZone: string;
  now: Date;
}) {
  return cachedTodayShortlist(
    input.ownerUserId,
    input.localDate,
    input.timeZone,
    todayRefreshBucket(input.now),
  );
}

async function cachedTodayShortlist(
  ownerUserId: string,
  localDate: string,
  timeZone: string,
  refreshedAt: number,
) {
  "use cache";
  const contract = todayReviewCacheContract.today({ ownerUserId });
  cacheLife(cacheProfiles.interactive);
  cacheTag(...contract.tags);
  return getTodayShortlist({ ownerUserId, localDate, timeZone, now: new Date(refreshedAt) });
}

export async function getCachedReviewQueueFamily(ownerUserId: string, family: ReviewQueueFamily) {
  return cachedReviewQueueFamily(ownerUserId, family);
}

async function cachedReviewQueueFamily(ownerUserId: string, family: ReviewQueueFamily) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...todayReviewCacheContract.review({ ownerUserId }).tags);
  return loadOwnerReviewQueueFamily(ownerUserId, family);
}

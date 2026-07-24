import { getTodayShortlist } from "@tendnote/db/queries/today";
import { cacheLife, cacheTag } from "next/cache";
import type { ReviewQueueFamily } from "@/lib/review-queue";
import { loadOwnerReviewQueue, loadOwnerReviewQueueFamily } from "@/lib/review-queue.server";
import { cacheProfiles } from "./cache-profiles";

export const todayReviewCacheContract = {
  today(input: { ownerUserId: string; localDate: string; timeZone: string; refreshedAt: number }) {
    return {
      // Today is a live, time-sensitive shortlist. Its bounded 30-second refresh
      // bucket is deliberately part of the cache identity; a request timestamp is
      // not, because it would create a cold entry for every render.
      key: [
        "today",
        input.ownerUserId,
        input.localDate,
        input.timeZone,
        input.refreshedAt,
      ] as const,
      tags: [
        `today:owner:${input.ownerUserId}`,
        `today:owner:${input.ownerUserId}:shortlist`,
      ] as const,
    };
  },
  review(input: { ownerUserId: string }) {
    return {
      key: ["review", input.ownerUserId] as const,
      tags: [
        `review:owner:${input.ownerUserId}`,
        `review:owner:${input.ownerUserId}:queue`,
      ] as const,
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
  const contract = todayReviewCacheContract.today({
    ownerUserId,
    localDate,
    timeZone,
    refreshedAt,
  });
  cacheLife(cacheProfiles.interactive);
  cacheTag(...contract.tags);
  return getTodayShortlist({ ownerUserId, localDate, timeZone, now: new Date(refreshedAt) });
}

export async function getCachedReviewQueue(ownerUserId: string) {
  return cachedReviewQueue(ownerUserId);
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

async function cachedReviewQueue(ownerUserId: string) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...todayReviewCacheContract.review({ ownerUserId }).tags);
  return loadOwnerReviewQueue(ownerUserId);
}

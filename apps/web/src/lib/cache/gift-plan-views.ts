import { getGiftPlanDetail, listGiftPlans } from "@tendnote/db/queries/gift-plans";
import { cacheLife, cacheTag } from "next/cache";
import {
  type GiftPlanPeopleLabels,
  toGiftPlanDetailView,
  toGiftPlanView,
} from "@/lib/gift-plan-view";
import { tagForAffectedScope, tagsForAffectedScope } from "./affected-scope-tags";
import { cacheProfiles } from "./cache-profiles";

const REFRESH_MS = 30_000;

function refreshBucket(now: Date) {
  return Math.floor(now.getTime() / REFRESH_MS) * REFRESH_MS;
}

/**
 * Cache identity and tags for Gift Plan views.
 *
 * Every tag names a viewer. There is deliberately no viewer-agnostic entity tag
 * of the kind the Asset and Saved Item families have: a Gift Plan's audience is
 * not the whole of who may see it, so an entry keyed by record alone could be
 * filled for a co-planner and served to the Surprise Subject. Per-viewer
 * identity makes that impossible rather than merely unlikely.
 *
 * The cached function still calls the seam, which proves from memberships and
 * shares read at that moment — so a stale entry is only ever a stale *copy of an
 * answer this viewer was already entitled to*, and the write that changes their
 * entitlement names them in its affected scopes (ADR 0219).
 */
const giftPlanCacheContract = {
  collection(callerUserId: string) {
    return tagsForAffectedScope({
      kind: "viewer-collection",
      collection: "gift-plans",
      viewerUserId: callerUserId,
    });
  },
  entity(callerUserId: string, giftPlanId: string) {
    return tagForAffectedScope({
      kind: "viewer-entity",
      entity: "gift-plan",
      entityId: giftPlanId,
      viewerUserId: callerUserId,
    });
  },
};

export async function getCachedGiftPlanViews(input: {
  callerUserId: string;
  people: GiftPlanPeopleLabels;
  now: Date;
}) {
  return cachedGiftPlanViews(input.callerUserId, input.people, refreshBucket(input.now));
}

export async function getCachedGiftPlanDetailView(input: {
  callerUserId: string;
  giftPlanId: string;
  people: GiftPlanPeopleLabels;
  now: Date;
}) {
  return cachedGiftPlanDetailView(
    input.callerUserId,
    input.giftPlanId,
    input.people,
    refreshBucket(input.now),
  );
}

async function cachedGiftPlanViews(
  callerUserId: string,
  people: GiftPlanPeopleLabels,
  refreshedAt: number,
) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...giftPlanCacheContract.collection(callerUserId));
  const plans = await listGiftPlans({ callerUserId });
  const now = new Date(refreshedAt);
  return plans.map((plan) => {
    cacheTag(giftPlanCacheContract.entity(callerUserId, plan.id));
    return toGiftPlanView(plan, people, now);
  });
}

async function cachedGiftPlanDetailView(
  callerUserId: string,
  giftPlanId: string,
  people: GiftPlanPeopleLabels,
  refreshedAt: number,
) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...giftPlanCacheContract.collection(callerUserId));
  cacheTag(giftPlanCacheContract.entity(callerUserId, giftPlanId));
  const detail = await getGiftPlanDetail({ callerUserId, giftPlanId });
  return detail ? toGiftPlanDetailView(detail, people, new Date(refreshedAt)) : null;
}

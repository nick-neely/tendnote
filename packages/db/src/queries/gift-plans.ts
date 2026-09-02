import { privatizeGiftPlansForEndedAccess } from "./gift-plans/departure";
import { createDrizzleGiftPlanLifecycleStore } from "./gift-plans/drizzle-store";
import { createGiftPlanLifecycle } from "./gift-plans/lifecycle";

export { affectedScopesForGiftPlan } from "./gift-plans/affected-scopes";
export { privatizeGiftPlansForEndedAccess } from "./gift-plans/departure";
export {
  createDrizzleGiftPlanLifecycleStore,
  createDrizzleGiftPlanStore,
} from "./gift-plans/drizzle-store";
export {
  createInMemoryGiftPlanLifecycleStore,
  createInMemoryGiftPlanStore,
} from "./gift-plans/in-memory-store";
export { createGiftPlanLifecycle, type GiftPlanLifecycle } from "./gift-plans/lifecycle";
export type * from "./gift-plans/types";

const defaultGiftPlanStore = createDrizzleGiftPlanLifecycleStore();
const defaultGiftPlans = createGiftPlanLifecycle(defaultGiftPlanStore);

/**
 * The Gift Plan entry points.
 *
 * Every one takes the caller's own user id from the session and a record id,
 * and nothing here takes a household id, an audience, a role, or a claim of
 * standing: the household is resolved from the plan, the audience from the share
 * registry, and the caller's memberships from their own rows — all read inside
 * the seam, at the moment of the call. There is no shape of argument on this
 * page that can widen what someone is allowed to see.
 *
 * Reads answer `null`, an empty list, or `0`. There is no variant that reports a
 * plan exists but is withheld, because for a Surprise Subject that report is the
 * protected fact (ADR 0216).
 *
 * Anything deferred — a cached page, a queued job, a streamed region — calls one
 * of these again at its last safe point rather than reusing what it was handed.
 * These are the *only* supported way to reach a Gift Plan; `gift_plans`,
 * `gift_ideas`, and `gift_plan_events` are not to be queried anywhere else
 * (ADR 0219, and `gift-plans/seam.test.ts` pins it).
 */
export function getGiftPlan(input: { callerUserId: string; giftPlanId: string }) {
  return defaultGiftPlans.getGiftPlan(input);
}

export function getGiftPlanDetail(input: { callerUserId: string; giftPlanId: string }) {
  return defaultGiftPlans.getGiftPlanDetail(input);
}

/**
 * One idea with the plan it belongs to, behind the plan's own proof.
 *
 * The idea tools name an idea by id and nothing else, so this is how a surface
 * that has to *show* somebody what they are about to change gets from the id to
 * the words — without a second query that could answer differently.
 */
export function getGiftIdea(input: { callerUserId: string; giftIdeaId: string }) {
  return defaultGiftPlans.getGiftIdea(input);
}

export function listGiftPlans(input: {
  callerUserId: string;
  includeArchived?: boolean;
  limit?: number;
}) {
  return defaultGiftPlans.listGiftPlans(input);
}

export function searchGiftPlans(input: { callerUserId: string; query: string; limit?: number }) {
  return defaultGiftPlans.searchGiftPlans(input);
}

export function countGiftPlans(input: { callerUserId: string }) {
  return defaultGiftPlans.countGiftPlans(input);
}

export function createGiftPlan(input: Parameters<typeof defaultGiftPlans.createGiftPlan>[0]) {
  return defaultGiftPlans.createGiftPlan(input);
}

export function editGiftPlan(input: Parameters<typeof defaultGiftPlans.editGiftPlan>[0]) {
  return defaultGiftPlans.editGiftPlan(input);
}

export function setGiftPlanAudience(
  input: Parameters<typeof defaultGiftPlans.setGiftPlanAudience>[0],
) {
  return defaultGiftPlans.setGiftPlanAudience(input);
}

export function setGiftPlanSurpriseSubject(
  input: Parameters<typeof defaultGiftPlans.setGiftPlanSurpriseSubject>[0],
) {
  return defaultGiftPlans.setGiftPlanSurpriseSubject(input);
}

export function setGiftPlanStatus(input: Parameters<typeof defaultGiftPlans.setGiftPlanStatus>[0]) {
  return defaultGiftPlans.setGiftPlanStatus(input);
}

export function deleteGiftPlan(input: Parameters<typeof defaultGiftPlans.deleteGiftPlan>[0]) {
  return defaultGiftPlans.deleteGiftPlan(input);
}

export function addGiftIdea(input: Parameters<typeof defaultGiftPlans.addGiftIdea>[0]) {
  return defaultGiftPlans.addGiftIdea(input);
}

export function editGiftIdea(input: Parameters<typeof defaultGiftPlans.editGiftIdea>[0]) {
  return defaultGiftPlans.editGiftIdea(input);
}

export function removeGiftIdea(input: Parameters<typeof defaultGiftPlans.removeGiftIdea>[0]) {
  return defaultGiftPlans.removeGiftIdea(input);
}

export function claimGiftIdea(input: Parameters<typeof defaultGiftPlans.claimGiftIdea>[0]) {
  return defaultGiftPlans.claimGiftIdea(input);
}

export function releaseGiftIdea(input: Parameters<typeof defaultGiftPlans.releaseGiftIdea>[0]) {
  return defaultGiftPlans.releaseGiftIdea(input);
}

/**
 * The access-ended sweep, for the households module to hand to governance.
 *
 * It takes no caller because it is not a caller's operation: a departure has
 * already happened and this is the household telling the record family. It can
 * only narrow — a plan goes private and never the other way — so there is no
 * proof for it to obtain and nothing it could widen.
 */
export function privatizeGiftPlansForHouseholdAccessEnded(input: {
  householdId: string;
  userId?: string;
}) {
  return privatizeGiftPlansForEndedAccess(defaultGiftPlanStore.plans, input);
}

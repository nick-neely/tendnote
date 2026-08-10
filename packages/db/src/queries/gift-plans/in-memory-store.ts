import { randomUUID } from "node:crypto";
import type { GiftIdea, GiftPlan, GiftPlanEvent } from "@tendnote/domain";
import {
  createGiftIdeaSchema,
  createGiftPlanSchema,
  giftIdeaSchema,
  giftPlanSchema,
} from "@tendnote/domain";
import { createInMemoryHouseholdStore } from "../households/in-memory-store";
import type { GiftPlanHouseholdStore, GiftPlanLifecycleStore, GiftPlanStore } from "./types";

/**
 * The Gift Plan store as a faithful double, households included.
 *
 * It takes the household store rather than approximating one because
 * {@link GiftPlanStore.listGiftPlanCandidates} is where the pre-filter lives: in
 * Postgres that is a join against memberships and the share registry plus the
 * Surprise Subject clause, and a double that skipped the join would let the
 * exclusion tests pass against a narrower question than production asks.
 */
export function createInMemoryGiftPlanStore(households: GiftPlanHouseholdStore): GiftPlanStore {
  const plans = new Map<string, GiftPlan>();
  const ideas = new Map<string, GiftIdea>();
  const events: GiftPlanEvent[] = [];

  function requirePlan(giftPlanId: string): GiftPlan {
    const plan = plans.get(giftPlanId);
    if (!plan) throw new Error("Gift Plan not found.");
    return plan;
  }

  function requireIdea(giftIdeaId: string): GiftIdea {
    const idea = ideas.get(giftIdeaId);
    if (!idea) throw new Error("Gift Idea not found.");
    return idea;
  }

  /** The in-memory twin of `visibleHouseholdRecordSql` plus the exclusion clause. */
  async function isCandidate(plan: GiftPlan, callerUserId: string): Promise<boolean> {
    // The exclusion first and unconditionally, exactly as the SQL clause sits
    // outside the audience disjunction: no form of standing reaches past it.
    if (plan.surpriseSubjectUserId === callerUserId) return false;

    if (plan.scope === "private") return plan.ownerUserId === callerUserId;
    if (!plan.householdId) return false;

    const membership = await households.getHouseholdMembership({
      householdId: plan.householdId,
      userId: callerUserId,
    });
    if (membership?.status !== "active") return false;
    if (plan.ownerUserId === callerUserId) return true;
    if (plan.scope === "household") return true;

    const shares = await households.listHouseholdRecordShares({
      householdId: plan.householdId,
      recordKind: "gift_plan",
      recordId: plan.id,
    });
    return shares.some((share) => share.sharedWithUserId === callerUserId);
  }

  return {
    async createGiftPlan(input) {
      const parsed = createGiftPlanSchema.parse(input);
      const at = new Date();
      const plan = giftPlanSchema.parse({
        ...parsed,
        id: parsed.id ?? randomUUID(),
        status: "active",
        lastActorUserId: parsed.ownerUserId,
        revision: 0,
        createdAt: at,
        updatedAt: at,
      });
      plans.set(plan.id, plan);
      return plan;
    },

    async getGiftPlanById(input) {
      return plans.get(input.giftPlanId) ?? null;
    },

    async listGiftPlanCandidates(input) {
      const statuses = input.statuses ? new Set(input.statuses) : null;
      const query = input.query?.trim().toLowerCase();
      const matches: GiftPlan[] = [];
      for (const plan of plans.values()) {
        if (statuses && !statuses.has(plan.status)) continue;
        if (query && !`${plan.subjectName} ${plan.occasion}`.toLowerCase().includes(query)) {
          continue;
        }
        if (!(await isCandidate(plan, input.callerUserId))) continue;
        matches.push(plan);
      }
      matches.sort((a, b) => {
        const left = a.occasionOn?.getTime() ?? Number.POSITIVE_INFINITY;
        const right = b.occasionOn?.getTime() ?? Number.POSITIVE_INFINITY;
        return left === right ? b.createdAt.getTime() - a.createdAt.getTime() : left - right;
      });
      return input.limit ? matches.slice(0, input.limit) : matches;
    },

    async listGiftPlansInHousehold(input) {
      return [...plans.values()].filter(
        (plan) =>
          plan.householdId === input.householdId &&
          (!input.ownerUserId || plan.ownerUserId === input.ownerUserId),
      );
    },

    async updateGiftPlan(input) {
      const plan = requirePlan(input.giftPlanId);
      const updated = giftPlanSchema.parse({
        ...plan,
        ...input.patch,
        revision: plan.revision + 1,
        updatedAt: new Date(),
      });
      plans.set(updated.id, updated);
      return updated;
    },

    async deleteGiftPlan(input) {
      plans.delete(input.giftPlanId);
      for (const [id, idea] of ideas) {
        if (idea.giftPlanId === input.giftPlanId) ideas.delete(id);
      }
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index]?.giftPlanId === input.giftPlanId) events.splice(index, 1);
      }
    },

    async createGiftIdea(input) {
      const parsed = createGiftIdeaSchema.parse(input);
      const at = new Date();
      const idea = giftIdeaSchema.parse({
        ...parsed,
        id: parsed.id ?? randomUUID(),
        claimedByUserId: null,
        claimedAt: null,
        lastActorUserId: parsed.contributorUserId,
        revision: 0,
        createdAt: at,
        updatedAt: at,
      });
      ideas.set(idea.id, idea);
      return idea;
    },

    async getGiftIdeaById(input) {
      return ideas.get(input.giftIdeaId) ?? null;
    },

    async listGiftIdeas(input) {
      return [...ideas.values()]
        .filter((idea) => idea.giftPlanId === input.giftPlanId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    async updateGiftIdea(input) {
      const idea = requireIdea(input.giftIdeaId);
      const updated = giftIdeaSchema.parse({
        ...idea,
        ...input.patch,
        revision: idea.revision + 1,
        updatedAt: new Date(),
      });
      ideas.set(updated.id, updated);
      return updated;
    },

    async deleteGiftIdea(input) {
      ideas.delete(input.giftIdeaId);
    },

    async claimGiftIdeaIfUnclaimed(input) {
      const idea = requireIdea(input.giftIdeaId);
      // The check and the write with nothing awaited between them, which is what
      // the conditional UPDATE buys in Postgres: a second claimant arriving mid
      // flight must find the claim already taken, never an unclaimed idea.
      if (idea.claimedByUserId && idea.claimedByUserId !== input.claimantUserId) return null;
      const updated = giftIdeaSchema.parse({
        ...idea,
        claimedByUserId: input.claimantUserId,
        claimedAt: input.at,
        lastActorUserId: input.claimantUserId,
        revision: idea.revision + 1,
        updatedAt: input.at,
      });
      ideas.set(updated.id, updated);
      return updated;
    },

    async countGiftIdeasForPlans(input) {
      const wanted = new Set(input.giftPlanIds);
      const counts = new Map<string, { ideaCount: number; claimedIdeaCount: number }>();
      for (const idea of ideas.values()) {
        if (!wanted.has(idea.giftPlanId)) continue;
        const count = counts.get(idea.giftPlanId) ?? { ideaCount: 0, claimedIdeaCount: 0 };
        count.ideaCount += 1;
        if (idea.claimedByUserId) count.claimedIdeaCount += 1;
        counts.set(idea.giftPlanId, count);
      }
      return [...counts.entries()].map(([giftPlanId, count]) => ({ giftPlanId, ...count }));
    },

    async createGiftPlanEvent(input) {
      const event: GiftPlanEvent = {
        id: randomUUID(),
        giftPlanId: input.giftPlanId,
        kind: input.kind,
        actorUserId: input.actorUserId,
        detailJson: input.detailJson ?? {},
        createdAt: new Date(),
      };
      events.push(event);
      return event;
    },

    async listGiftPlanEvents(input) {
      const matches = events
        .filter((event) => event.giftPlanId === input.giftPlanId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return input.limit ? matches.slice(0, input.limit) : matches;
    },
  };
}

/**
 * Both halves of the seam's storage, wired together, for tests.
 *
 * The household store is returned so a suite can seed a roster and shares with
 * the same fixtures every other Household suite uses, rather than inventing a
 * second way to describe who lives together.
 */
export function createInMemoryGiftPlanLifecycleStore(): GiftPlanLifecycleStore & {
  households: ReturnType<typeof createInMemoryHouseholdStore>;
} {
  const households = createInMemoryHouseholdStore();
  return { plans: createInMemoryGiftPlanStore(households), households };
}

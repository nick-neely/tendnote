import {
  createGiftIdeaSchema,
  createGiftPlanSchema,
  giftIdeaSchema,
  giftIdeaUpdateSchema,
  giftPlanEventSchema,
  giftPlanSchema,
  giftPlanUpdateSchema,
} from "@tendnote/domain";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import { giftIdeas, giftPlanEvents, giftPlans } from "../../schema";
import { createDrizzleHouseholdStore } from "../households/drizzle-store";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import type { GiftPlanLifecycleStore, GiftPlanStore } from "./types";

const visibleGiftPlans = alias(giftPlans, "gp");
const PERSISTED_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPersistedId(id: string): boolean {
  return PERSISTED_ID_PATTERN.test(id);
}

/**
 * The Surprise Subject exclusion, in SQL.
 *
 * It sits *outside* the audience predicate and is `and`-ed with it, so no form
 * of standing — owner, whole-household, or selected co-planner — can reach past
 * it. That mirrors the proof, where the exclusion gate runs before the audience
 * gate and denies the record's own owner too (ADR 0216, ADR 0219).
 *
 * `is distinct from` rather than `<>` because the column is nullable and `null
 * <> 'someone'` is `null`, which would silently drop every unprotected plan from
 * every listing. Failing that way would be closed rather than open, but it would
 * also be invisible until someone noticed their plans had vanished.
 */
function notSurpriseSubjectSql(callerUserId: string) {
  return sql`gp.surprise_subject_user_id is distinct from ${callerUserId}`;
}

export function createDrizzleGiftPlanStore(): GiftPlanStore {
  return {
    async createGiftPlan(input) {
      const parsed = createGiftPlanSchema.parse(input);
      const [plan] = await getDb()
        .insert(giftPlans)
        .values({ ...parsed, lastActorUserId: parsed.ownerUserId })
        .returning();
      if (!plan) throw new Error("Gift Plan insert returned no row.");
      return giftPlanSchema.parse(plan);
    },

    async getGiftPlanById(input) {
      if (!isPersistedId(input.giftPlanId)) return null;
      const [plan] = await getDb()
        .select()
        .from(giftPlans)
        .where(eq(giftPlans.id, input.giftPlanId))
        .limit(1);
      return plan ? giftPlanSchema.parse(plan) : null;
    },

    /**
     * The pre-filter: the shared household predicate, and the exclusion.
     *
     * Every row here is proved again above this layer. The predicate exists so a
     * protected plan never leaves the database on a read by the person it is a
     * surprise for, and so the candidate set stays small; it is not the decision
     * (see `visibility-sql.ts`).
     */
    async listGiftPlanCandidates(input) {
      const query = input.query?.trim();
      const rows = await getDb()
        .select()
        .from(visibleGiftPlans)
        .where(
          and(
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "gp",
              recordKind: "gift_plan",
            }),
            notSurpriseSubjectSql(input.callerUserId),
            ...(input.statuses?.length ? [inArray(visibleGiftPlans.status, input.statuses)] : []),
            ...(query
              ? [
                  or(
                    ilike(visibleGiftPlans.subjectName, `%${query}%`),
                    ilike(visibleGiftPlans.occasion, `%${query}%`),
                  ),
                ]
              : []),
          ),
        )
        // Soonest occasion first, undated plans last, newest-made breaking ties:
        // a plan list is a calendar of celebrations, not an edit log.
        .orderBy(
          asc(isNull(visibleGiftPlans.occasionOn)),
          asc(visibleGiftPlans.occasionOn),
          desc(visibleGiftPlans.createdAt),
        )
        .limit(input.limit ?? 100);
      return rows.map((row) => giftPlanSchema.parse(row));
    },

    async listGiftPlansInHousehold(input) {
      const rows = await getDb()
        .select()
        .from(giftPlans)
        .where(
          and(
            eq(giftPlans.householdId, input.householdId),
            ...(input.ownerUserId ? [eq(giftPlans.ownerUserId, input.ownerUserId)] : []),
          ),
        );
      return rows.map((row) => giftPlanSchema.parse(row));
    },

    async updateGiftPlan(input) {
      const patch = giftPlanUpdateSchema.parse(input.patch);
      const [plan] = await getDb()
        .update(giftPlans)
        // The counter is bumped in SQL rather than read-then-written, so two
        // concurrent writers cannot both land on the same revision.
        .set({ ...patch, revision: sql`${giftPlans.revision} + 1`, updatedAt: new Date() })
        .where(eq(giftPlans.id, input.giftPlanId))
        .returning();
      if (!plan) throw new Error("Gift Plan not found.");
      return giftPlanSchema.parse(plan);
    },

    async deleteGiftPlan(input) {
      // Ideas and events cascade from the plan row: permanent deletion removes
      // the plan and its idea content rather than leaving a hidden archive.
      await getDb().delete(giftPlans).where(eq(giftPlans.id, input.giftPlanId));
    },

    async createGiftIdea(input) {
      const parsed = createGiftIdeaSchema.parse(input);
      const [idea] = await getDb()
        .insert(giftIdeas)
        .values({ ...parsed, lastActorUserId: parsed.contributorUserId })
        .returning();
      if (!idea) throw new Error("Gift Idea insert returned no row.");
      return giftIdeaSchema.parse(idea);
    },

    async getGiftIdeaById(input) {
      if (!isPersistedId(input.giftIdeaId)) return null;
      const [idea] = await getDb()
        .select()
        .from(giftIdeas)
        .where(eq(giftIdeas.id, input.giftIdeaId))
        .limit(1);
      return idea ? giftIdeaSchema.parse(idea) : null;
    },

    async listGiftIdeas(input) {
      const rows = await getDb()
        .select()
        .from(giftIdeas)
        .where(eq(giftIdeas.giftPlanId, input.giftPlanId))
        .orderBy(asc(giftIdeas.createdAt));
      return rows.map((row) => giftIdeaSchema.parse(row));
    },

    async updateGiftIdea(input) {
      const patch = giftIdeaUpdateSchema.parse(input.patch);
      const [idea] = await getDb()
        .update(giftIdeas)
        .set({ ...patch, revision: sql`${giftIdeas.revision} + 1`, updatedAt: new Date() })
        .where(eq(giftIdeas.id, input.giftIdeaId))
        .returning();
      if (!idea) throw new Error("Gift Idea not found.");
      return giftIdeaSchema.parse(idea);
    },

    async deleteGiftIdea(input) {
      await getDb().delete(giftIdeas).where(eq(giftIdeas.id, input.giftIdeaId));
    },

    /**
     * The claim, in one statement.
     *
     * `where claimed_by_user_id is null` is the whole of the atomicity: two
     * concurrent claimants both run this, exactly one updates a row, and the
     * other gets no row back and is told who has it. Reading first and writing
     * second would leave precisely the window in which two people buy the same
     * gift, which is the reason self-claims exist at all.
     */
    async claimGiftIdeaIfUnclaimed(input) {
      const [idea] = await getDb()
        .update(giftIdeas)
        .set({
          claimedByUserId: input.claimantUserId,
          claimedAt: input.at,
          lastActorUserId: input.claimantUserId,
          revision: sql`${giftIdeas.revision} + 1`,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(giftIdeas.id, input.giftIdeaId),
            or(
              isNull(giftIdeas.claimedByUserId),
              eq(giftIdeas.claimedByUserId, input.claimantUserId),
            ),
          ),
        )
        .returning();
      return idea ? giftIdeaSchema.parse(idea) : null;
    },

    async countGiftIdeasForPlans(input) {
      if (input.giftPlanIds.length === 0) return [];
      const rows = await getDb()
        .select({
          giftPlanId: giftIdeas.giftPlanId,
          ideaCount: count(giftIdeas.id),
          claimedIdeaCount: count(giftIdeas.claimedByUserId),
        })
        .from(giftIdeas)
        .where(inArray(giftIdeas.giftPlanId, [...input.giftPlanIds]))
        .groupBy(giftIdeas.giftPlanId);
      return rows.map((row) => ({
        giftPlanId: row.giftPlanId,
        ideaCount: Number(row.ideaCount),
        claimedIdeaCount: Number(row.claimedIdeaCount),
      }));
    },

    async createGiftPlanEvent(input) {
      const [event] = await getDb()
        .insert(giftPlanEvents)
        .values({
          giftPlanId: input.giftPlanId,
          kind: input.kind,
          actorUserId: input.actorUserId,
          detailJson: input.detailJson ?? {},
        })
        .returning();
      if (!event) throw new Error("Gift Plan event insert returned no row.");
      return giftPlanEventSchema.parse(event);
    },

    async listGiftPlanEvents(input) {
      const rows = await getDb()
        .select()
        .from(giftPlanEvents)
        .where(eq(giftPlanEvents.giftPlanId, input.giftPlanId))
        .orderBy(desc(giftPlanEvents.createdAt))
        .limit(input.limit ?? 50);
      return rows.map((row) => giftPlanEventSchema.parse(row));
    },
  };
}

export function createDrizzleGiftPlanLifecycleStore(): GiftPlanLifecycleStore {
  return { plans: createDrizzleGiftPlanStore(), households: createDrizzleHouseholdStore() };
}

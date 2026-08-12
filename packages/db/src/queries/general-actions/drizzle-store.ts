import {
  createGeneralActionEventSchema,
  createGeneralActionSchema,
  generalActionEventSchema,
  generalActionSchema,
  generalActionUpdateSchema,
  REVIEW_GENERAL_ACTION_STATUSES,
} from "@tendnote/domain";
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import {
  generalActionEvents,
  generalActionOfferDeclines,
  generalActionPeople,
  generalActions,
  householdRecordShares,
} from "../../schema";
import { createDrizzleGeneralActionAreaStore } from "../general-action-areas/drizzle-store";
import { provenVisibleRecord } from "../households/authorization";
import { createDrizzleHouseholdStore } from "../households/drizzle-store";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import { createDrizzleSourceRecordStore } from "../source-records/drizzle-store";
import type { GeneralActionLifecycleStore, GeneralActionStore } from "./types";

// Aliased so the scope-visibility predicate can reference the row as `ga`, matching
// the alias the shared `visibleHouseholdRecordSql` builder expects.
const visibleGeneralActions = alias(generalActions, "ga");

/**
 * Owner-scoped fetch of a single General Action by id. Shared by the lifecycle store's
 * `getGeneralAction` and the embedding store's `getGeneralActionForEmbedding` so the
 * owner-scoping predicate stays identical across the two Drizzle stores.
 */
export async function selectOwnedGeneralAction(input: {
  ownerUserId: string;
  generalActionId: string;
}) {
  const [action] = await getDb()
    .select()
    .from(generalActions)
    .where(
      and(
        eq(generalActions.id, input.generalActionId),
        eq(generalActions.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  return action ? generalActionSchema.parse(action) : null;
}

// Review-gated rows (suggested/ignored proposals) are owner-only: every scope-visible
// read excludes them so a household member can never fetch or read the history of a
// proposal that has not been accepted (ADRs 0151, 0152, 0153).
const durableVisibleStatus = notInArray(visibleGeneralActions.status, [
  ...REVIEW_GENERAL_ACTION_STATUSES,
]);

// Shared ordering contract: the soonest-relevant action leads, unscheduled (both
// dates null) fall to the end, most-recently-created breaks ties. The in-memory
// store's `surfacingTime` mirrors this expression; keep the two in step.
const surfacingOrder = [
  sql`coalesce(${generalActions.deferUntil}, ${generalActions.dueAt}) asc nulls last`,
  desc(generalActions.createdAt),
];
const visibleSurfacingOrder = [
  sql`coalesce(${visibleGeneralActions.deferUntil}, ${visibleGeneralActions.dueAt}) asc nulls last`,
  desc(visibleGeneralActions.createdAt),
];

/**
 * Drizzle-backed General Action CRUD + history + people-link store. Owner scoping is
 * enforced in every owner-keyed predicate so a caller can only read or mutate their
 * own actions; the `Visible` reads apply the shared Phase 4 scope predicate so
 * household and selected-shared actions surface to the members who may see them
 * (AGENTS.md owner-scoped seams; ADR 0153).
 */
export function createDrizzleGeneralActionStore(): GeneralActionStore {
  return {
    async createGeneralAction(values) {
      const [action] = await getDb()
        .insert(generalActions)
        .values(createGeneralActionSchema.parse(values))
        .returning();

      if (!action) {
        throw new Error("Failed to create action.");
      }

      return generalActionSchema.parse(action);
    },
    async createGeneralActionBundle(input) {
      const actionValues = createGeneralActionSchema.parse(input.action);
      const personIds = [...new Set(input.personIds)];
      const sharedWithUserIds = [...new Set(input.sharedWithUserIds)];

      return getDb().transaction(async (tx) => {
        const { action, created } = await persistAction();
        if (!created) return generalActionSchema.parse(action);
        await persistPeople(action.id);
        await persistShares(action);
        await persistInitialEvent(action.id);
        return generalActionSchema.parse(action);

        async function persistAction() {
          const [action] = await tx
            .insert(generalActions)
            .values(actionValues)
            .onConflictDoNothing({ target: generalActions.id })
            .returning();
          if (action) return { action, created: true };
          if (!actionValues.id) throw new Error("Failed to create action.");
          const [existing] = await tx
            .select()
            .from(generalActions)
            .where(
              and(
                eq(generalActions.id, actionValues.id),
                eq(generalActions.ownerUserId, actionValues.ownerUserId),
              ),
            )
            .limit(1);
          if (!existing) throw new Error("Failed to create action.");
          return { action: existing, created: false };
        }

        async function persistPeople(generalActionId: string) {
          if (personIds.length === 0) return;
          await tx
            .insert(generalActionPeople)
            .values(personIds.map((personId) => ({ generalActionId, personId })));
        }

        async function persistShares(action: typeof generalActions.$inferSelect) {
          const householdId = action.householdId;
          if (action.scope !== "shared" || !householdId || sharedWithUserIds.length === 0) return;
          if (!action.ownerUserId) throw new Error("A member-owned shared action needs an owner.");
          const sharedByUserId = action.ownerUserId;
          await tx
            .insert(householdRecordShares)
            .values(
              sharedWithUserIds.map((sharedWithUserId) => ({
                householdId,
                recordKind: "general_action" as const,
                recordId: action.id,
                sharedWithUserId,
                sharedByUserId,
              })),
            )
            .onConflictDoNothing();
        }

        async function persistInitialEvent(generalActionId: string) {
          const [event] = await tx
            .insert(generalActionEvents)
            .values(createGeneralActionEventSchema.parse({ ...input.event, generalActionId }))
            .returning();
          if (!event) throw new Error("Failed to record action history.");
          generalActionEventSchema.parse(event);
        }
      });
    },
    async getGeneralAction(input) {
      return selectOwnedGeneralAction(input);
    },
    async getVisibleGeneralAction(input) {
      const [action] = await getDb()
        .select()
        .from(visibleGeneralActions)
        .where(
          and(
            eq(visibleGeneralActions.id, input.generalActionId),
            durableVisibleStatus,
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "ga",
              recordKind: "general_action",
            }),
          ),
        )
        .limit(1);

      // The predicate above narrowed the candidate; this is what authorizes the
      // read. It re-decides against memberships and shares read now, so a member
      // who left between the page render and this call is refused here — and it
      // returns null on refusal, which is the same answer as "no such action".
      const proven = await provenVisibleRecord({
        callerUserId: input.callerUserId,
        row: action,
        facts: (row) => ({
          kind: "general_action",
          id: row.id,
          ownerUserId: row.ownerUserId,
          scope: row.scope,
          householdId: row.householdId,
          ownership: row.ownership,
        }),
      });

      return proven ? generalActionSchema.parse(proven) : null;
    },
    async updateGeneralAction(input) {
      // Validate the patched fields so constraints hold for direct store callers.
      // A defaults-free schema is essential here: a partial of the base schema
      // would inject default values for absent keys and wipe those columns on
      // update (dueAt, notes, links, scope, …).
      const patch = generalActionUpdateSchema.parse(input.patch);
      const [action] = await getDb()
        .update(generalActions)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(generalActions.id, input.generalActionId),
            eq(generalActions.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();

      if (!action) {
        throw new Error("Action not found.");
      }

      return generalActionSchema.parse(action);
    },
    async advanceGeneralActionOccurrence(input) {
      const patch = generalActionUpdateSchema.parse(input.patch);
      // One conditional statement, so nothing can slip between the fence check
      // and the write. The increment is expressed in SQL rather than computed
      // here for the same reason: the row decides its own next version.
      const [action] = await getDb()
        .update(generalActions)
        .set({
          ...patch,
          occurrenceVersion: sql`${generalActions.occurrenceVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(generalActions.id, input.generalActionId),
            eq(generalActions.ownerUserId, input.ownerUserId),
            eq(generalActions.occurrenceVersion, input.expectedOccurrenceVersion),
          ),
        )
        .returning();

      // No row matched: either the record is gone, or another member advanced
      // this occurrence first. The lifecycle re-reads and reconciles, so both
      // settle on authoritative state rather than raising.
      return action ? generalActionSchema.parse(action) : null;
    },
    async listGeneralActionsForHousehold(input) {
      const rows = await getDb()
        .select()
        .from(generalActions)
        .where(
          and(
            eq(generalActions.householdId, input.householdId),
            ...(input.ownership ? [eq(generalActions.ownership, input.ownership)] : []),
            ...(input.statuses && input.statuses.length > 0
              ? [inArray(generalActions.status, input.statuses)]
              : []),
          ),
        )
        .orderBy(...surfacingOrder);
      return rows.map((row) => generalActionSchema.parse(row));
    },
    async clearResponsibilityHolderForMember(input) {
      const rows = await getDb()
        .update(generalActions)
        .set({ responsibilityHolderUserId: null, updatedAt: new Date() })
        .where(
          and(
            eq(generalActions.householdId, input.householdId),
            eq(generalActions.responsibilityHolderUserId, input.userId),
          ),
        )
        .returning();
      return rows.map((row) => generalActionSchema.parse(row));
    },
    async revertMemberOwnedGeneralActionsToPrivate(input) {
      const rows = await getDb()
        .update(generalActions)
        .set({ scope: "private", householdId: null, updatedAt: new Date() })
        .where(
          and(
            eq(generalActions.householdId, input.householdId),
            eq(generalActions.ownerUserId, input.ownerUserId),
            eq(generalActions.ownership, "member_owned"),
            ne(generalActions.scope, "private"),
          ),
        )
        .returning();
      return rows.map((row) => generalActionSchema.parse(row));
    },
    async listGeneralActionOfferDeclines(input) {
      const rows = await getDb()
        .select({ userId: generalActionOfferDeclines.userId })
        .from(generalActionOfferDeclines)
        .where(
          and(
            eq(generalActionOfferDeclines.generalActionId, input.generalActionId),
            eq(generalActionOfferDeclines.offerKind, input.offerKind),
          ),
        );
      return rows.map((row) => row.userId);
    },
    async declineGeneralActionOffer(input) {
      await getDb().insert(generalActionOfferDeclines).values(input).onConflictDoNothing();
    },
    async listGeneralActionsForOwner(input) {
      const query = getDb()
        .select()
        .from(generalActions)
        .where(
          and(
            eq(generalActions.ownerUserId, input.ownerUserId),
            ...(input.statuses && input.statuses.length > 0
              ? [inArray(generalActions.status, input.statuses)]
              : []),
          ),
        )
        .orderBy(...surfacingOrder);

      const rows = await (input.limit === undefined ? query : query.limit(input.limit));
      return rows.map((row) => generalActionSchema.parse(row));
    },
    async listVisibleGeneralActionsForCaller(input) {
      // Scope filtering happens here, pre-retrieval: the predicate keeps private
      // actions to their owner and admits household / selected-shared ones only for
      // members who may see them, so nothing out of scope ever reaches the surface.
      const query = getDb()
        .select()
        .from(visibleGeneralActions)
        .where(
          and(
            durableVisibleStatus,
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "ga",
              recordKind: "general_action",
            }),
            ...(input.statuses && input.statuses.length > 0
              ? [inArray(visibleGeneralActions.status, input.statuses)]
              : []),
          ),
        )
        .orderBy(...visibleSurfacingOrder);

      const rows = await (input.limit === undefined ? query : query.limit(input.limit));
      return rows.map((row) => generalActionSchema.parse(row));
    },
    async setGeneralActionPeople(input) {
      // Replace the whole set in one transaction so a link edit is atomic — no
      // window where an action shows a half-applied set of people. Owner-keyed: the
      // ownership check inside the transaction means a direct caller can't rewrite
      // another owner's links, mirroring `updateGeneralAction`.
      const unique = [...new Set(input.personIds)];
      await getDb().transaction(async (tx) => {
        const [owned] = await tx
          .select({ id: generalActions.id })
          .from(generalActions)
          .where(
            and(
              eq(generalActions.id, input.generalActionId),
              eq(generalActions.ownerUserId, input.ownerUserId),
            ),
          )
          .limit(1);
        if (!owned) {
          throw new Error("Action not found.");
        }
        await tx
          .delete(generalActionPeople)
          .where(eq(generalActionPeople.generalActionId, input.generalActionId));
        if (unique.length > 0) {
          await tx.insert(generalActionPeople).values(
            unique.map((personId) => ({
              generalActionId: input.generalActionId,
              personId,
            })),
          );
        }
      });
    },
    async listGeneralActionPersonIds(input) {
      // Owner-keyed via a join to `general_actions`: returns nothing for an action
      // the caller does not own.
      const rows = await getDb()
        .select({ personId: generalActionPeople.personId })
        .from(generalActionPeople)
        .innerJoin(generalActions, eq(generalActions.id, generalActionPeople.generalActionId))
        .where(
          and(
            eq(generalActionPeople.generalActionId, input.generalActionId),
            eq(generalActions.ownerUserId, input.ownerUserId),
          ),
        )
        .orderBy(asc(generalActionPeople.createdAt));

      return rows.map((row) => row.personId);
    },
    async createGeneralActionEvent(values) {
      const [event] = await getDb()
        .insert(generalActionEvents)
        .values(createGeneralActionEventSchema.parse(values))
        .returning();

      if (!event) {
        throw new Error("Failed to record action history.");
      }

      return generalActionEventSchema.parse(event);
    },
    async listGeneralActionEvents(input) {
      const rows = await getDb()
        .select()
        .from(generalActionEvents)
        .where(
          and(
            eq(generalActionEvents.ownerUserId, input.ownerUserId),
            eq(generalActionEvents.generalActionId, input.generalActionId),
          ),
        )
        .orderBy(asc(generalActionEvents.createdAt));

      return rows.map((row) => generalActionEventSchema.parse(row));
    },
  };
}

/**
 * General Action lifecycle store: the CRUD/history/visibility store plus the
 * source-record store for grounding and owner-scoped person resolution, the Area
 * store for Area assignment, and the household store for scope membership and shares.
 * Mirrors the Follow-Up lifecycle-store composition (ADRs 0153, 0154).
 */
export function createDrizzleGeneralActionLifecycleStore(): GeneralActionLifecycleStore {
  return {
    ...createDrizzleSourceRecordStore(),
    ...createDrizzleHouseholdStore(),
    ...createDrizzleGeneralActionAreaStore(),
    ...createDrizzleGeneralActionStore(),
  };
}

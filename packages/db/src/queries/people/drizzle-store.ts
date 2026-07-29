import { ACTIVE_FOLLOWUP_STATUSES } from "@tendnote/domain";
import { and, count, eq, ilike, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import {
  auditLog,
  followups,
  memories,
  messageDrafts,
  people,
  sourceRecordPeople,
  sourceRecords,
} from "../../schema";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import type { PeopleStore } from "./types";

const visibleProfileFollowups = alias(followups, "f");

/**
 * Follow-ups the person page asks the owner to do something about: the active
 * reminders (`ACTIVE_FOLLOWUP_STATUSES`, shared with `isActiveFollowupStatus`)
 * plus the tentative proposals still awaiting a yes or no.
 */
const FOLLOWUP_TAB_STATUSES = [...ACTIVE_FOLLOWUP_STATUSES, "suggested" as const];

/** Drafts that are still in play: written or approved, not yet sent or dismissed. */
const DRAFT_TAB_STATUSES = ["draft", "approved"] as const;

/**
 * `count(*) filter (where ...)` as a number. Postgres evaluates every filtered
 * aggregate in a single pass over the rows the query already scans, so one table
 * costs one query however many tab counts it feeds.
 */
function countWhere(condition: SQL | undefined) {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
}

/** The owner-scoped person row, or null when the caller does not own this person. */
async function selectOwnedPerson(input: { ownerUserId: string; personId: string }) {
  const [person] = await getDb()
    .select()
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.ownerUserId, input.ownerUserId)))
    .limit(1);

  return person ?? null;
}

/** The person row without an owner filter — only reachable once visibility is proven. */
async function selectPersonById(personId: string) {
  const [person] = await getDb().select().from(people).where(eq(people.id, personId)).limit(1);

  return person ?? null;
}

/**
 * The one predicate that decides whether a non-owner may see a person at all: a
 * household member reaches a profile only through a follow-up shared with them. Both
 * profile reads share it so the count they gate on and the rows they return can never
 * disagree about who is visible.
 */
function visibleProfileFollowupsWhere(input: { callerUserId: string; personId: string }) {
  return and(
    eq(visibleProfileFollowups.personId, input.personId),
    visibleHouseholdRecordSql({
      callerUserId: input.callerUserId,
      tableAlias: "f",
      recordKind: "followup",
    }),
  );
}

export function createDrizzlePeopleStore(): PeopleStore {
  return {
    async createPerson(values) {
      const [person] = await getDb().insert(people).values(values).returning();

      if (!person) {
        throw new Error("Failed to create person.");
      }

      return person;
    },

    async updatePerson({ ownerUserId, personId, patch }) {
      const [person] = await getDb()
        .update(people)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(people.id, personId), eq(people.ownerUserId, ownerUserId)))
        .returning();

      return person ?? null;
    },

    async deletePerson({ ownerUserId, personId }) {
      // Owner-scoped hard delete. Every person-owned table's foreign key is
      // `on delete cascade`/`set null`, so Postgres removes the memories,
      // follow-ups, drafts, snapshots, and contact methods (and null- links the
      // historical brief/source references) atomically with the person. The audit
      // row has no foreign key to `people`, so the deletion record survives.
      const [person] = await getDb()
        .delete(people)
        .where(and(eq(people.id, personId), eq(people.ownerUserId, ownerUserId)))
        .returning();

      return person ?? null;
    },

    async createAuditLogEntry(values) {
      await getDb().insert(auditLog).values(values);
    },

    async searchPeople(input) {
      // The match + order here are the SQL mirror of the shared contract
      // (`personMatchesPeopleSearch` / `comparePeopleForSearch` in @tendnote/domain):
      // trimmed case-insensitive substring over display/first/last name, ordered by
      // display name with a stable id tie-break. The in-memory adapter applies those
      // rules directly, so its tests validate the fields and ordering production uses.
      // (Display-name case/locale ordering follows the database collation, as the
      // domain comparator's localeCompare does — the id tie-break is exact either way.)
      const where: SQL[] = [eq(people.ownerUserId, input.ownerUserId)];

      // Match the predicate's trim so a padded query behaves identically here and in
      // the in-memory adapter even when a caller bypasses searchPeopleSchema.
      const query = input.query?.trim();
      if (query) {
        const queryFilter = or(
          ilike(people.displayName, `%${query}%`),
          ilike(people.firstName, `%${query}%`),
          ilike(people.lastName, `%${query}%`),
        );

        if (queryFilter) {
          where.push(queryFilter);
        }
      }

      if (input.relationshipType) {
        where.push(eq(people.relationshipType, input.relationshipType));
      }

      return getDb()
        .select()
        .from(people)
        .where(and(...where))
        .limit(input.limit)
        .orderBy(people.displayName, people.id);
    },

    async getPerson(input) {
      return selectOwnedPerson(input);
    },

    async getPersonDetailCore(input) {
      let person = await selectOwnedPerson(input);

      if (!person) {
        // Visibility is still decided by *any* shared follow-up; the second
        // aggregate is only what the viewer's Follow-ups tab would list, so the
        // gate and the badge can be honest about different things at once.
        const [visibleCounts] = await getDb()
          .select({
            visible: count(),
            followups: countWhere(inArray(visibleProfileFollowups.status, FOLLOWUP_TAB_STATUSES)),
          })
          .from(visibleProfileFollowups)
          .where(
            visibleProfileFollowupsWhere({
              callerUserId: input.ownerUserId,
              personId: input.personId,
            }),
          );

        if (!visibleCounts?.visible) return null;

        person = await selectPersonById(input.personId);
        if (!person) return null;

        // A household viewer reaches this profile through follow-ups alone -
        // memories, review, and drafts are the owner's and stay invisible here.
        return {
          person,
          counts: { memories: 0, review: 0, followups: visibleCounts.followups, drafts: 0 },
        };
      }

      // Each aggregate below is the SQL mirror of the filter its surface applies
      // in memory: `canUseMemoryProactively` for confirmed memories, the
      // suggested-review queries, `isActiveFollowupStatus` plus proposals, and
      // the drafts the review surface keeps open.
      const [[memoryCounts], [followupCount], [draftCount]] = await Promise.all([
        getDb()
          .select({
            confirmed: countWhere(
              and(eq(memories.status, "approved"), ne(memories.sensitivity, "restricted")),
            ),
            suggested: countWhere(eq(memories.status, "suggested")),
          })
          .from(memories)
          .where(
            and(eq(memories.personId, input.personId), eq(memories.ownerUserId, input.ownerUserId)),
          ),
        getDb()
          .select({ count: count() })
          .from(followups)
          .where(
            and(
              eq(followups.personId, input.personId),
              eq(followups.ownerUserId, input.ownerUserId),
              inArray(followups.status, FOLLOWUP_TAB_STATUSES),
            ),
          ),
        getDb()
          .select({ count: count() })
          .from(messageDrafts)
          .where(
            and(
              eq(messageDrafts.personId, input.personId),
              eq(messageDrafts.ownerUserId, input.ownerUserId),
              inArray(messageDrafts.status, DRAFT_TAB_STATUSES),
            ),
          ),
      ]);

      return {
        person,
        counts: {
          memories: memoryCounts?.confirmed ?? 0,
          review: memoryCounts?.suggested ?? 0,
          followups: followupCount?.count ?? 0,
          drafts: draftCount?.count ?? 0,
        },
      };
    },

    async getPersonProfile(input) {
      let person = await selectOwnedPerson(input);

      if (!person) {
        const visibleFollowups = await getDb()
          .select()
          .from(visibleProfileFollowups)
          .where(
            visibleProfileFollowupsWhere({
              callerUserId: input.ownerUserId,
              personId: input.personId,
            }),
          );

        if (visibleFollowups.length === 0) {
          return null;
        }

        person = await selectPersonById(input.personId);

        if (!person) {
          return null;
        }

        return {
          person,
          memories: [],
          followups: visibleFollowups,
          sourceRecords: [],
        };
      }

      const [personMemories, personFollowups, personSourceRecords] = await Promise.all([
        getDb()
          .select()
          .from(memories)
          .where(
            and(eq(memories.personId, input.personId), eq(memories.ownerUserId, input.ownerUserId)),
          ),
        getDb()
          .select()
          .from(followups)
          .where(
            and(
              eq(followups.personId, input.personId),
              eq(followups.ownerUserId, input.ownerUserId),
            ),
          ),
        getDb()
          .select({ sourceRecord: sourceRecords })
          .from(sourceRecordPeople)
          .innerJoin(sourceRecords, eq(sourceRecordPeople.sourceRecordId, sourceRecords.id))
          .where(
            and(
              eq(sourceRecordPeople.personId, input.personId),
              eq(sourceRecords.ownerUserId, input.ownerUserId),
            ),
          ),
      ]);

      return {
        person,
        memories: personMemories,
        followups: personFollowups,
        sourceRecords: personSourceRecords.map((row) => row.sourceRecord),
      };
    },
  };
}

import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb } from "../../client";
import {
  auditLog,
  followups,
  memories,
  people,
  sourceRecordPeople,
  sourceRecords,
} from "../../schema";
import type { PeopleStore } from "./types";

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

    async getPersonProfile(input) {
      const [person] = await getDb()
        .select()
        .from(people)
        .where(and(eq(people.id, input.personId), eq(people.ownerUserId, input.ownerUserId)))
        .limit(1);

      if (!person) {
        return null;
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

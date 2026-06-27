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

    async createAuditLogEntry(values) {
      await getDb().insert(auditLog).values(values);
    },

    async searchPeople(input) {
      const where: SQL[] = [eq(people.ownerUserId, input.ownerUserId)];

      if (input.query) {
        const queryFilter = or(
          ilike(people.displayName, `%${input.query}%`),
          ilike(people.firstName, `%${input.query}%`),
          ilike(people.lastName, `%${input.query}%`),
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
        .orderBy(people.displayName);
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

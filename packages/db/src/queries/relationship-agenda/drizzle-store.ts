import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import { memories, people, sourceRecordPeople, sourceRecords } from "../../schema";
import { createDrizzleFollowupLifecycleStore } from "../followups/drizzle-store";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import { createDrizzleMemoryStore } from "../memories/drizzle-store";
import { searchSemanticContext } from "../semantic-retrieval";
import type { RelationshipAgendaSourceRecordReview, RelationshipAgendaStore } from "./types";

const visibleAgendaMemories = alias(memories, "m");
const visibleAgendaSourceRecords = alias(sourceRecords, "sr");

export function createDrizzleRelationshipAgendaStore(): RelationshipAgendaStore {
  const followupStore = createDrizzleFollowupLifecycleStore();
  const memoryStore = createDrizzleMemoryStore();

  return {
    listActiveFollowupsForOwner: followupStore.listActiveFollowupsForOwner,
    listVisibleActiveFollowups: followupStore.listVisibleActiveFollowups,
    listSuggestedFollowupsForOwner: followupStore.listSuggestedFollowupsForOwner,
    listVisibleSuggestedFollowups: followupStore.listVisibleSuggestedFollowups,
    getPerson: followupStore.getPerson,
    getSourceRecord: followupStore.getSourceRecord,
    listSuggestedMemoriesForOwner: memoryStore.listSuggestedMemoriesForOwner,
    async listVisibleSuggestedMemories(input) {
      return getDb()
        .select()
        .from(visibleAgendaMemories)
        .where(
          and(
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "m",
              recordKind: "memory",
            }),
            eq(visibleAgendaMemories.status, "suggested"),
          ),
        )
        .orderBy(desc(visibleAgendaMemories.importance), desc(visibleAgendaMemories.createdAt))
        .limit(input.limit ?? 20);
    },
    async listPeople(input) {
      return getDb()
        .select()
        .from(people)
        .where(eq(people.ownerUserId, input.ownerUserId))
        .orderBy(people.displayName);
    },
    async listSourceRecordReviewsForOwner(input) {
      const rows = await getDb()
        .select()
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.ownerUserId, input.ownerUserId),
            eq(sourceRecords.status, "pending_resolution"),
          ),
        )
        .orderBy(desc(sourceRecords.createdAt))
        .limit(input.limit ?? 20);

      return Promise.all(
        rows.map(async (sourceRecord) => {
          const linkedPeople = await getDb()
            .select({ id: people.id, displayName: people.displayName })
            .from(sourceRecordPeople)
            .innerJoin(people, eq(sourceRecordPeople.personId, people.id))
            .where(
              and(
                eq(sourceRecordPeople.sourceRecordId, sourceRecord.id),
                eq(people.ownerUserId, input.ownerUserId),
              ),
            )
            .orderBy(people.displayName);

          return { sourceRecord, linkedPeople };
        }),
      );
    },
    async listVisibleSourceRecordReviews(input) {
      const rows = await getDb()
        .select()
        .from(visibleAgendaSourceRecords)
        .where(
          and(
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "sr",
              recordKind: "source_record",
            }),
            inArray(visibleAgendaSourceRecords.status, ["active", "pending_resolution"]),
          ),
        )
        .orderBy(desc(visibleAgendaSourceRecords.createdAt))
        .limit(input.limit ?? 20);

      return Promise.all(
        rows.map(async (sourceRecord) => {
          const linkedPeople = await getDb()
            .select({ id: people.id, displayName: people.displayName })
            .from(sourceRecordPeople)
            .innerJoin(people, eq(sourceRecordPeople.personId, people.id))
            .where(eq(sourceRecordPeople.sourceRecordId, sourceRecord.id))
            .orderBy(people.displayName);

          return { sourceRecord, linkedPeople };
        }),
      );
    },
    async listRecentSourceRecordsForOwner(input) {
      const rows = await getDb()
        .select({
          sourceRecord: sourceRecords,
          person: { id: people.id, displayName: people.displayName },
        })
        .from(sourceRecordPeople)
        .innerJoin(sourceRecords, eq(sourceRecordPeople.sourceRecordId, sourceRecords.id))
        .innerJoin(people, eq(sourceRecordPeople.personId, people.id))
        .where(
          and(
            eq(sourceRecords.ownerUserId, input.ownerUserId),
            eq(sourceRecords.status, "active"),
            ne(sourceRecords.sensitivity, "restricted"),
            eq(people.ownerUserId, input.ownerUserId),
          ),
        )
        .orderBy(desc(sourceRecords.createdAt))
        .limit((input.limit ?? 3) * 4);

      const reviewsByRecord = new Map<string, RelationshipAgendaSourceRecordReview>();

      for (const row of rows) {
        const existing = reviewsByRecord.get(row.sourceRecord.id);

        if (existing) {
          existing.linkedPeople.push(row.person);
        } else {
          reviewsByRecord.set(row.sourceRecord.id, {
            sourceRecord: row.sourceRecord,
            linkedPeople: [row.person],
          });
        }
      }

      return [...reviewsByRecord.values()].slice(0, input.limit ?? 3);
    },
    async listVisibleRecentSourceRecords(input) {
      const rows = await getDb()
        .select({
          sourceRecord: visibleAgendaSourceRecords,
          person: { id: people.id, displayName: people.displayName },
        })
        .from(sourceRecordPeople)
        .innerJoin(
          visibleAgendaSourceRecords,
          eq(sourceRecordPeople.sourceRecordId, visibleAgendaSourceRecords.id),
        )
        .innerJoin(people, eq(sourceRecordPeople.personId, people.id))
        .where(
          and(
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "sr",
              recordKind: "source_record",
            }),
            eq(visibleAgendaSourceRecords.status, "active"),
            ne(visibleAgendaSourceRecords.sensitivity, "restricted"),
          ),
        )
        .orderBy(desc(visibleAgendaSourceRecords.createdAt), people.displayName)
        .limit((input.limit ?? 3) * 4);

      const reviewsByRecord = new Map<string, RelationshipAgendaSourceRecordReview>();

      for (const row of rows) {
        const existing = reviewsByRecord.get(row.sourceRecord.id);

        if (existing) {
          existing.linkedPeople.push(row.person);
        } else {
          reviewsByRecord.set(row.sourceRecord.id, {
            sourceRecord: row.sourceRecord,
            linkedPeople: [row.person],
          });
        }
      }

      return [...reviewsByRecord.values()].slice(0, input.limit ?? 3);
    },
    async searchSemanticContext(input) {
      return searchSemanticContext({
        ...input,
        limit: input.limit ?? 3,
        minimumSimilarity: 0,
        directlyRequested: input.directlyRequested ?? false,
      });
    },
  };
}

import type { Person, SourceRecord } from "@tendnote/domain";
import { and, desc, eq, ne } from "drizzle-orm";
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

/**
 * The people a source record names, in display order.
 *
 * `ownerUserId` narrows the join to that owner's own people, which is what the
 * owner-scoped reads need: a record can be linked to a person row belonging to
 * someone else, and an owner-scoped read must not surface it. The
 * visibility-scoped reads leave it off deliberately - `visibleHouseholdRecordSql`
 * has already decided the caller may see the record, and a shared note is only
 * answerable with everyone it names.
 */
async function linkedPeopleForSourceRecord(sourceRecordId: string, ownerUserId?: string) {
  return getDb()
    .select({ id: people.id, displayName: people.displayName })
    .from(sourceRecordPeople)
    .innerJoin(people, eq(sourceRecordPeople.personId, people.id))
    .where(
      and(
        eq(sourceRecordPeople.sourceRecordId, sourceRecordId),
        ...(ownerUserId ? [eq(people.ownerUserId, ownerUserId)] : []),
      ),
    )
    .orderBy(people.displayName);
}

/**
 * Attach each record's people, turning a page of source records into the review
 * shape the agenda reads. Owner-scoped and visibility-scoped reads share this so
 * they can only ever differ on *who* is allowed in a review, never on how one is
 * assembled.
 */
async function toSourceRecordReviews(
  rows: SourceRecord[],
  ownerUserId?: string,
): Promise<RelationshipAgendaSourceRecordReview[]> {
  return Promise.all(
    rows.map(async (sourceRecord) => ({
      sourceRecord,
      linkedPeople: await linkedPeopleForSourceRecord(sourceRecord.id, ownerUserId),
    })),
  );
}

/**
 * Fold person-joined rows back into one review per record.
 *
 * The recent-context reads join through `sourceRecordPeople`, so a note naming
 * three people arrives as three rows. That is why they over-fetch by 4x and cap
 * here instead of in SQL: `limit` counts notes, not links, and a note keeps every
 * person it named.
 */
function toReviewsFromLinkedRows(
  rows: Array<{ sourceRecord: SourceRecord; person: Pick<Person, "id" | "displayName"> }>,
  limit: number,
): RelationshipAgendaSourceRecordReview[] {
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

  return [...reviewsByRecord.values()].slice(0, limit);
}

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

      return toSourceRecordReviews(rows, input.ownerUserId);
    },
    /**
     * Source records awaiting person resolution: the same gate the owner-scoped
     * read above applies, now that plain `active` logged context no longer counts
     * as review (it is filed, not pending).
     */
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
            eq(visibleAgendaSourceRecords.status, "pending_resolution"),
          ),
        )
        .orderBy(desc(visibleAgendaSourceRecords.createdAt))
        .limit(input.limit ?? 20);

      return toSourceRecordReviews(rows);
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

      return toReviewsFromLinkedRows(rows, input.limit ?? 3);
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

      return toReviewsFromLinkedRows(rows, input.limit ?? 3);
    },
    async searchSemanticContext(input) {
      return searchSemanticContext({
        ...input,
        // The relationship agenda is person-centered: it draws on approved memories and
        // logged source records, never General Actions (ADRs 0143, 0155), so scope the
        // semantic call to those two kinds.
        recordKinds: ["memory", "source_record"],
        limit: input.limit ?? 3,
        minimumSimilarity: 0,
        directlyRequested: input.directlyRequested ?? false,
      });
    },
  };
}

import { and, desc, eq, ilike } from "drizzle-orm";
import { getDb } from "../../client";
import {
  auditLog,
  people,
  sourceRecordPeople,
  sourceRecords,
  unresolvedPersonMentions,
} from "../../schema";
import type {
  ListSourceRecordReviewsInput,
  SourceRecordResolutionStore,
  SourceRecordReviewComponent,
} from "./types";

export function createDrizzleSourceRecordStore(): SourceRecordResolutionStore {
  return {
    async createPerson(values) {
      const [person] = await getDb().insert(people).values(values).returning();

      if (!person) {
        throw new Error("Failed to create person.");
      }

      return person;
    },
    async getPerson(input) {
      const [person] = await getDb()
        .select()
        .from(people)
        .where(and(eq(people.id, input.personId), eq(people.ownerUserId, input.ownerUserId)))
        .limit(1);

      return person ?? null;
    },
    async findPeopleByDisplayName(input) {
      return getDb()
        .select()
        .from(people)
        .where(
          and(
            eq(people.ownerUserId, input.ownerUserId),
            ilike(people.displayName, `%${input.mentionText}%`),
          ),
        )
        .limit(input.limit ?? 10);
    },
    async createSourceRecord(values) {
      const [sourceRecord] = await getDb().insert(sourceRecords).values(values).returning();

      if (!sourceRecord) {
        throw new Error("Failed to capture source record.");
      }

      return sourceRecord;
    },
    async updateSourceRecordStatus(input) {
      const [sourceRecord] = await getDb()
        .update(sourceRecords)
        .set({
          status: input.status,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sourceRecords.id, input.sourceRecordId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();

      if (!sourceRecord) {
        throw new Error("Source record not found.");
      }

      return sourceRecord;
    },
    async createUnresolvedMention(values) {
      const [unresolvedMention] = await getDb()
        .insert(unresolvedPersonMentions)
        .values(values)
        .returning();

      if (!unresolvedMention) {
        throw new Error("Failed to create unresolved person mention.");
      }

      return unresolvedMention;
    },
    async linkSourceRecordPerson(values) {
      const [link] = await getDb()
        .insert(sourceRecordPeople)
        .values(values)
        .onConflictDoUpdate({
          target: [sourceRecordPeople.sourceRecordId, sourceRecordPeople.personId],
          set: {
            role: values.role,
          },
        })
        .returning();

      if (!link) {
        throw new Error("Failed to link source record to person.");
      }

      return link;
    },
    async resolveUnresolvedMention(input) {
      const [unresolvedMention] = await getDb()
        .update(unresolvedPersonMentions)
        .set({
          status: "resolved",
          resolvedPersonId: input.personId,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(unresolvedPersonMentions.id, input.unresolvedMentionId),
            eq(unresolvedPersonMentions.sourceRecordId, input.sourceRecordId),
          ),
        )
        .returning();

      if (!unresolvedMention) {
        throw new Error("Unresolved mention not found.");
      }

      return unresolvedMention;
    },
    async dismissUnresolvedMention(input) {
      const [unresolvedMention] = await getDb()
        .update(unresolvedPersonMentions)
        .set({
          status: "dismissed",
        })
        .where(
          and(
            eq(unresolvedPersonMentions.id, input.unresolvedMentionId),
            eq(unresolvedPersonMentions.sourceRecordId, input.sourceRecordId),
          ),
        )
        .returning();

      if (!unresolvedMention) {
        throw new Error("Unresolved mention not found.");
      }

      return unresolvedMention;
    },
    async listSourceRecordsForPersonContext(input) {
      const rows = await getDb()
        .select({ sourceRecord: sourceRecords })
        .from(sourceRecordPeople)
        .innerJoin(sourceRecords, eq(sourceRecordPeople.sourceRecordId, sourceRecords.id))
        .where(
          and(
            eq(sourceRecordPeople.personId, input.personId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
            eq(sourceRecords.status, "active"),
          ),
        )
        .orderBy(desc(sourceRecords.createdAt));

      return rows.map((row) => row.sourceRecord);
    },
    async createAuditLogEntry(values) {
      const [auditLogEntry] = await getDb().insert(auditLog).values(values).returning();

      if (!auditLogEntry) {
        throw new Error("Failed to write source record audit log.");
      }

      return {
        ...auditLogEntry,
        ownerUserId: auditLogEntry.ownerUserId ?? values.ownerUserId,
      };
    },
    async getSourceRecord(input) {
      const [sourceRecord] = await getDb()
        .select()
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.id, input.sourceRecordId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);

      return sourceRecord ?? null;
    },
  };
}

export async function listSourceRecordReviews(input: ListSourceRecordReviewsInput) {
  const rows = await getDb()
    .select()
    .from(sourceRecords)
    .where(eq(sourceRecords.ownerUserId, input.ownerUserId))
    .orderBy(desc(sourceRecords.createdAt))
    .limit(input.limit ?? 5);

  return Promise.all(
    rows.map(async (sourceRecord) => {
      const linkedPeople = await getDb()
        .select({ id: people.id, displayName: people.displayName })
        .from(sourceRecordPeople)
        .innerJoin(people, eq(sourceRecordPeople.personId, people.id))
        .where(eq(sourceRecordPeople.sourceRecordId, sourceRecord.id))
        .orderBy(people.displayName);

      return {
        sourceRecord,
        linkedPeople,
        component: {
          type: "source_record_review",
          sourceRecordId: sourceRecord.id,
        } satisfies SourceRecordReviewComponent,
      };
    }),
  );
}

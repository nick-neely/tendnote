import { and, asc, desc, eq, ilike } from "drizzle-orm";
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
      const [sourceRecord] = await getDb()
        .insert(sourceRecords)
        .values(values)
        .onConflictDoNothing({ target: sourceRecords.id })
        .returning();
      if (sourceRecord) return sourceRecord;
      if (!values.id) throw new Error("Failed to capture source record.");

      const [existing] = await getDb()
        .select()
        .from(sourceRecords)
        .where(
          and(eq(sourceRecords.id, values.id), eq(sourceRecords.ownerUserId, values.ownerUserId)),
        )
        .limit(1);
      if (!existing) throw new Error("Failed to capture source record.");
      return existing;
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
    async updateSourceRecordMetadata(input) {
      const [sourceRecord] = await getDb()
        .update(sourceRecords)
        .set({
          metadataJson: input.metadataJson,
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
    async listUnresolvedMentions(input) {
      return getDb()
        .select()
        .from(unresolvedPersonMentions)
        .where(eq(unresolvedPersonMentions.sourceRecordId, input.sourceRecordId))
        .orderBy(unresolvedPersonMentions.createdAt);
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
    async unlinkSourceRecordPerson(input) {
      await getDb()
        .delete(sourceRecordPeople)
        .where(
          and(
            eq(sourceRecordPeople.sourceRecordId, input.sourceRecordId),
            eq(sourceRecordPeople.personId, input.personId),
          ),
        );
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
      const [created] = await getDb()
        .insert(auditLog)
        .values(values)
        .onConflictDoNothing({ target: auditLog.id })
        .returning();
      let auditLogEntry = created;
      if (!auditLogEntry && values.id) {
        [auditLogEntry] = await getDb()
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.id, values.id), eq(auditLog.ownerUserId, values.ownerUserId)))
          .limit(1);
      }

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
    async listAuditLogEntries(input) {
      const rows = await getDb()
        .select()
        .from(auditLog)
        .where(eq(auditLog.ownerUserId, input.ownerUserId))
        .orderBy(asc(auditLog.createdAt));
      return rows.map((entry) => ({
        ...entry,
        ownerUserId: entry.ownerUserId ?? input.ownerUserId,
      }));
    },
  };
}

export async function listSourceRecordReviews(input: ListSourceRecordReviewsInput) {
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
    .limit(input.limit ?? 5);

  return Promise.all(
    rows.map(async (sourceRecord) => {
      const [linkedPeople, unresolvedMentions] = await Promise.all([
        getDb()
          .select({ id: people.id, displayName: people.displayName })
          .from(sourceRecordPeople)
          .innerJoin(people, eq(sourceRecordPeople.personId, people.id))
          .where(eq(sourceRecordPeople.sourceRecordId, sourceRecord.id))
          .orderBy(people.displayName),
        getDb()
          .select()
          .from(unresolvedPersonMentions)
          .where(
            and(
              eq(unresolvedPersonMentions.sourceRecordId, sourceRecord.id),
              eq(unresolvedPersonMentions.status, "unresolved"),
            ),
          )
          .orderBy(unresolvedPersonMentions.createdAt),
      ]);

      return {
        sourceRecord,
        linkedPeople,
        unresolvedMentions,
        component: {
          type: "source_record_review",
          sourceRecordId: sourceRecord.id,
        } satisfies SourceRecordReviewComponent,
      };
    }),
  );
}

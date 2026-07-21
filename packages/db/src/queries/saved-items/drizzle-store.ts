import {
  createSavedItemSchema,
  savedItemEventSchema,
  savedItemOutcomeSchema,
  savedItemSchema,
  savedItemUpdateSchema,
} from "@tendnote/domain";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import {
  auditLog,
  householdRecordShares,
  relationshipContextEmbeddingJobs,
  relationshipContextEmbeddings,
  savedItemEvents,
  savedItemOutcomes,
  savedItems,
  sourceRecords,
} from "../../schema";
import { createDrizzleHouseholdStore } from "../households/drizzle-store";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import { createDrizzleSourceRecordStore } from "../source-records/drizzle-store";
import type { SavedItemLifecycleStore, SavedItemStore, SourceRecordDependency } from "./types";

const visibleSavedItems = alias(savedItems, "si");
const PERSISTED_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPersistedId(id: string): boolean {
  return PERSISTED_ID_PATTERN.test(id);
}

function buildSourceRecordDependenciesQuery(input: {
  ownerUserId: string;
  sourceRecordId: string;
}) {
  return sql<SourceRecordDependency>`
    SELECT 'memory'::text AS "recordKind", id::text AS "recordId"
    FROM memories
    WHERE owner_user_id = ${input.ownerUserId} AND source_record_id = ${input.sourceRecordId}
    UNION ALL
    SELECT 'general_action'::text AS "recordKind", id::text AS "recordId"
    FROM general_actions
    WHERE owner_user_id = ${input.ownerUserId} AND source_record_id = ${input.sourceRecordId}
    UNION ALL
    SELECT 'followup'::text AS "recordKind", id::text AS "recordId"
    FROM followups
    WHERE owner_user_id = ${input.ownerUserId} AND source_record_id = ${input.sourceRecordId}
    UNION ALL
    SELECT 'asset_review_group'::text AS "recordKind", id::text AS "recordId"
    FROM asset_review_groups
    WHERE owner_user_id = ${input.ownerUserId} AND source_record_id = ${input.sourceRecordId}
    UNION ALL
    SELECT 'asset_memory'::text AS "recordKind", id::text AS "recordId"
    FROM asset_memories
    WHERE owner_user_id = ${input.ownerUserId} AND source_record_id = ${input.sourceRecordId}
    UNION ALL
    SELECT 'asset_evidence'::text AS "recordKind", id::text AS "recordId"
    FROM asset_evidence
    WHERE owner_user_id = ${input.ownerUserId} AND source_record_id = ${input.sourceRecordId}
    UNION ALL
    SELECT 'asset_link'::text AS "recordKind", id::text AS "recordId"
    FROM asset_links
    WHERE owner_user_id = ${input.ownerUserId} AND source_record_id = ${input.sourceRecordId}
    UNION ALL
    SELECT 'person_link'::text AS "recordKind", id::text AS "recordId"
    FROM source_record_people
    WHERE source_record_id = ${input.sourceRecordId}
    UNION ALL
    SELECT 'unresolved_person_mention'::text AS "recordKind", id::text AS "recordId"
    FROM unresolved_person_mentions
    WHERE source_record_id = ${input.sourceRecordId}
  `;
}

export function createDrizzleSavedItemStore(): SavedItemStore {
  return {
    async createSavedItem(values) {
      const [item] = await getDb()
        .insert(savedItems)
        .values(createSavedItemSchema.parse(values))
        .returning();
      if (!item) throw new Error("Failed to create Saved Item.");
      return savedItemSchema.parse(item);
    },
    async getSavedItem(input) {
      if (!isPersistedId(input.savedItemId)) return null;
      const [item] = await getDb()
        .select()
        .from(savedItems)
        .where(
          and(eq(savedItems.id, input.savedItemId), eq(savedItems.ownerUserId, input.ownerUserId)),
        )
        .limit(1);
      return item ? savedItemSchema.parse(item) : null;
    },
    async getVisibleSavedItem(input) {
      if (!isPersistedId(input.savedItemId)) return null;
      const [item] = await getDb()
        .select()
        .from(visibleSavedItems)
        .where(
          and(
            eq(visibleSavedItems.id, input.savedItemId),
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "si",
              recordKind: "saved_item",
            }),
          ),
        )
        .limit(1);
      return item ? savedItemSchema.parse(item) : null;
    },
    async updateSavedItem(input) {
      const patch = savedItemUpdateSchema.parse(input.patch);
      const [item] = await getDb()
        .update(savedItems)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(savedItems.id, input.savedItemId), eq(savedItems.ownerUserId, input.ownerUserId)),
        )
        .returning();
      if (!item) throw new Error("Saved Item not found.");
      return savedItemSchema.parse(item);
    },
    async listVisibleSavedItems(input) {
      const rows = await getDb()
        .select()
        .from(visibleSavedItems)
        .where(
          and(
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "si",
              recordKind: "saved_item",
            }),
            ...(input.statuses?.length ? [inArray(visibleSavedItems.status, input.statuses)] : []),
            ...(input.scopes?.length ? [inArray(visibleSavedItems.scope, input.scopes)] : []),
          ),
        )
        .orderBy(desc(visibleSavedItems.updatedAt))
        .limit(input.limit ?? 100);
      return rows.map((row) => savedItemSchema.parse(row));
    },
    async listSavedItemsBySourceRecord(input) {
      if (!isPersistedId(input.sourceRecordId)) return [];
      const rows = await getDb()
        .select()
        .from(savedItems)
        .where(
          and(
            eq(savedItems.ownerUserId, input.ownerUserId),
            eq(savedItems.sourceRecordId, input.sourceRecordId),
          ),
        )
        .orderBy(asc(savedItems.createdAt));
      return rows.map((row) => savedItemSchema.parse(row));
    },
    async listSourceRecordDependencies(input) {
      if (!isPersistedId(input.sourceRecordId)) return [];
      const rows = await getDb().execute(buildSourceRecordDependenciesQuery(input));
      return [...rows].map((row) => ({
        recordKind: row.recordKind as SourceRecordDependency["recordKind"],
        recordId: String(row.recordId),
      }));
    },
    async searchVisibleSavedItems(input) {
      const rows = await getDb()
        .select()
        .from(visibleSavedItems)
        .where(
          and(
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "si",
              recordKind: "saved_item",
            }),
            input.includeArchived
              ? inArray(visibleSavedItems.status, ["active", "archived"])
              : eq(visibleSavedItems.status, "active"),
            or(
              ilike(visibleSavedItems.title, `%${input.query}%`),
              ilike(visibleSavedItems.content, `%${input.query}%`),
              ilike(visibleSavedItems.url, `%${input.query}%`),
            ),
          ),
        )
        .orderBy(desc(visibleSavedItems.updatedAt))
        .limit(input.limit ?? 20);
      return rows.map((row) => savedItemSchema.parse(row));
    },
    async createSavedItemEvent(values) {
      const parsed = savedItemEventSchema.omit({ id: true, createdAt: true }).parse(values);
      const [event] = await getDb().insert(savedItemEvents).values(parsed).returning();
      if (!event) throw new Error("Failed to record Saved Item audit event.");
      return savedItemEventSchema.parse(event);
    },
    async listSavedItemEvents(input) {
      if (!isPersistedId(input.savedItemId)) return [];
      const rows = await getDb()
        .select()
        .from(savedItemEvents)
        .where(
          and(
            eq(savedItemEvents.ownerUserId, input.ownerUserId),
            eq(savedItemEvents.savedItemId, input.savedItemId),
          ),
        )
        .orderBy(asc(savedItemEvents.createdAt));
      return rows.map((row) => savedItemEventSchema.parse(row));
    },
    async createSavedItemOutcome(values) {
      const parsed = savedItemOutcomeSchema.omit({ id: true, createdAt: true }).parse(values);
      const [created] = await getDb()
        .insert(savedItemOutcomes)
        .values(parsed)
        .onConflictDoNothing({ target: savedItemOutcomes.idempotencyKey })
        .returning();
      if (created) return savedItemOutcomeSchema.parse(created);
      const [existing] = await getDb()
        .select()
        .from(savedItemOutcomes)
        .where(eq(savedItemOutcomes.idempotencyKey, parsed.idempotencyKey))
        .limit(1);
      if (!existing) throw new Error("Failed to link Saved Item outcome.");
      return savedItemOutcomeSchema.parse(existing);
    },
    async listSavedItemOutcomes(input) {
      if (!isPersistedId(input.savedItemId)) return [];
      const rows = await getDb()
        .select()
        .from(savedItemOutcomes)
        .where(eq(savedItemOutcomes.savedItemId, input.savedItemId))
        .orderBy(asc(savedItemOutcomes.createdAt));
      return rows.map((row) => savedItemOutcomeSchema.parse(row));
    },
    async deleteUniqueSavedItemSourceEvidence(input) {
      await getDb().transaction(async (tx) => {
        const [item] = await tx
          .select({ id: savedItems.id, sourceScope: sourceRecords.scope })
          .from(savedItems)
          .innerJoin(sourceRecords, eq(sourceRecords.id, savedItems.sourceRecordId))
          .where(
            and(
              eq(savedItems.id, input.savedItemId),
              eq(savedItems.ownerUserId, input.ownerUserId),
              eq(savedItems.sourceRecordId, input.sourceRecordId),
              eq(sourceRecords.ownerUserId, input.ownerUserId),
            ),
          )
          .limit(1);
        if (!item) throw new Error("Saved Item source evidence not found.");
        const linkedItems = await tx
          .select({ id: savedItems.id })
          .from(savedItems)
          .where(
            and(
              eq(savedItems.ownerUserId, input.ownerUserId),
              eq(savedItems.sourceRecordId, input.sourceRecordId),
            ),
          )
          .limit(2);
        const linkedOutcomes = await tx
          .select({ id: savedItemOutcomes.id })
          .from(savedItemOutcomes)
          .where(eq(savedItemOutcomes.savedItemId, input.savedItemId))
          .limit(1);
        const dependencies = await tx.execute(buildSourceRecordDependenciesQuery(input));
        if (
          item.sourceScope !== "private" ||
          linkedItems.length !== 1 ||
          linkedOutcomes.length > 0 ||
          dependencies.length > 0
        ) {
          throw new Error(
            "This source is shared or reused. Review its impact before deleting evidence.",
          );
        }
        const semanticRecord = and(
          eq(relationshipContextEmbeddings.ownerUserId, input.ownerUserId),
          or(
            and(
              eq(relationshipContextEmbeddings.recordKind, "saved_item"),
              eq(relationshipContextEmbeddings.recordId, input.savedItemId),
            ),
            and(
              eq(relationshipContextEmbeddings.recordKind, "source_record"),
              eq(relationshipContextEmbeddings.recordId, input.sourceRecordId),
            ),
          ),
        );
        const semanticJob = and(
          eq(relationshipContextEmbeddingJobs.ownerUserId, input.ownerUserId),
          or(
            and(
              eq(relationshipContextEmbeddingJobs.recordKind, "saved_item"),
              eq(relationshipContextEmbeddingJobs.recordId, input.savedItemId),
            ),
            and(
              eq(relationshipContextEmbeddingJobs.recordKind, "source_record"),
              eq(relationshipContextEmbeddingJobs.recordId, input.sourceRecordId),
            ),
          ),
        );
        await tx.delete(relationshipContextEmbeddings).where(semanticRecord);
        await tx.delete(relationshipContextEmbeddingJobs).where(semanticJob);
        await tx
          .delete(householdRecordShares)
          .where(
            or(
              and(
                eq(householdRecordShares.recordKind, "saved_item"),
                eq(householdRecordShares.recordId, input.savedItemId),
              ),
              and(
                eq(householdRecordShares.recordKind, "source_record"),
                eq(householdRecordShares.recordId, input.sourceRecordId),
              ),
            ),
          );
        await tx
          .delete(savedItems)
          .where(
            and(
              eq(savedItems.id, input.savedItemId),
              eq(savedItems.ownerUserId, input.ownerUserId),
            ),
          );
        await tx
          .delete(sourceRecords)
          .where(
            and(
              eq(sourceRecords.id, input.sourceRecordId),
              eq(sourceRecords.ownerUserId, input.ownerUserId),
            ),
          );
        await tx.insert(auditLog).values({
          ownerUserId: input.ownerUserId,
          action: "saved_item.source_evidence_deleted",
          entityType: "saved_item_source",
          entityId: input.savedItemId,
          metadataJson: { sourceRecordId: input.sourceRecordId },
        });
      });
    },
  };
}

export function createDrizzleSavedItemLifecycleStore(): SavedItemLifecycleStore {
  return {
    ...createDrizzleSourceRecordStore(),
    ...createDrizzleHouseholdStore(),
    ...createDrizzleSavedItemStore(),
  };
}

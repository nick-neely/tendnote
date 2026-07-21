import {
  assetMemorySchema,
  assetSchema,
  claimableEmbeddingJobStatuses,
  createEmbeddingJobSchema,
  createRelationshipContextEmbeddingSchema,
  type GeneralActionStatus,
  type SemanticRetrievalResult,
  savedItemSchema,
  visibilityChoiceForScope,
  visibilityLabelForScope,
} from "@tendnote/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../client";
import {
  assetMemories,
  assets,
  relationshipContextEmbeddingJobs,
  relationshipContextEmbeddings,
  savedItems,
  sourceRecordPeople,
  sourceRecords,
  unresolvedPersonMentions,
} from "../../schema";
import { selectOwnedAsset } from "../assets/drizzle-store";
import { selectOwnedGeneralAction } from "../general-actions/drizzle-store";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import { createDrizzleMemoryStore } from "../memories/drizzle-store";
import type { EmbeddingStore, UpdateEmbeddingJobInput } from "./types";

const CLAIMABLE_STATUSES = [...claimableEmbeddingJobStatuses];

type SemanticMemorySearchRow = {
  record_kind: "memory" | "source_record" | "general_action";
  record_id: string;
  owner_user_id: string;
  household_id: string | null;
  scope: "private" | "shared" | "household";
  related_person_id: string | null;
  related_person_display_name: string | null;
  snippet: string;
  similarity: string | number;
  trust_level: "confirmed_fact" | "logged_context" | "action_item";
  sensitivity: "normal" | "sensitive" | "restricted";
  importance: number;
  updated_at: Date;
  // Populated only for `general_action` rows so the typed result can narrow the kind to
  // Action / Routine / Suggested without a second fetch (AC4). Null for every other kind.
  general_action_status: GeneralActionStatus | null;
  general_action_is_routine: boolean | null;
  general_action_area_id: string | null;
};

type SavedItemSemanticSearchRow = {
  saved_item_id: string;
  title: string;
  snippet: string;
  similarity: number | string;
  status: "active" | "archived";
  scope: "private" | "shared" | "household";
};

function buildJobUpdate(input: UpdateEmbeddingJobInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (input.status !== undefined) updates.status = input.status;
  if (input.lastError !== undefined) updates.lastError = input.lastError;
  if (input.runAfter !== undefined) updates.runAfter = input.runAfter;
  if ("claimedAt" in input) updates.claimedAt = input.claimedAt;
  if ("completedAt" in input) updates.completedAt = input.completedAt;

  return updates;
}

export function createDrizzleEmbeddingStore(): EmbeddingStore {
  const base = createDrizzleMemoryStore();

  return {
    ...base,
    async listSourceRecordPeople(input) {
      const rows = await getDb()
        .select()
        .from(sourceRecordPeople)
        .innerJoin(sourceRecords, eq(sourceRecordPeople.sourceRecordId, sourceRecords.id))
        .where(
          and(
            eq(sourceRecordPeople.sourceRecordId, input.sourceRecordId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
          ),
        )
        .orderBy(asc(sourceRecordPeople.createdAt));

      return rows.map((row) => row.source_record_people);
    },
    async listUnresolvedMentions(input) {
      if (!input.ownerUserId) return base.listUnresolvedMentions(input);
      const rows = await getDb()
        .select()
        .from(unresolvedPersonMentions)
        .innerJoin(sourceRecords, eq(unresolvedPersonMentions.sourceRecordId, sourceRecords.id))
        .where(
          and(
            eq(unresolvedPersonMentions.sourceRecordId, input.sourceRecordId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
          ),
        )
        .orderBy(asc(unresolvedPersonMentions.createdAt));

      return rows.map((row) => row.unresolved_person_mentions);
    },
    async createEmbeddingJob(values) {
      const [job] = await getDb()
        .insert(relationshipContextEmbeddingJobs)
        .values(createEmbeddingJobSchema.parse(values))
        .returning();

      if (!job) {
        throw new Error("Failed to create embedding job.");
      }

      return job;
    },
    async findEmbeddingJobByIdempotencyKey(idempotencyKey) {
      const [job] = await getDb()
        .select()
        .from(relationshipContextEmbeddingJobs)
        .where(eq(relationshipContextEmbeddingJobs.idempotencyKey, idempotencyKey))
        .limit(1);

      return job ?? null;
    },
    async getEmbeddingJob(jobId) {
      const [job] = await getDb()
        .select()
        .from(relationshipContextEmbeddingJobs)
        .where(eq(relationshipContextEmbeddingJobs.id, jobId))
        .limit(1);

      return job ?? null;
    },
    async claimEmbeddingJob(input) {
      const [job] = await getDb()
        .update(relationshipContextEmbeddingJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${relationshipContextEmbeddingJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(relationshipContextEmbeddingJobs.id, input.jobId),
            inArray(relationshipContextEmbeddingJobs.status, CLAIMABLE_STATUSES),
            lte(relationshipContextEmbeddingJobs.runAfter, input.now),
          ),
        )
        .returning();

      return job ?? null;
    },
    async claimNextEmbeddingJob(input) {
      const nextJob = getDb()
        .select({ id: relationshipContextEmbeddingJobs.id })
        .from(relationshipContextEmbeddingJobs)
        .where(
          and(
            inArray(relationshipContextEmbeddingJobs.status, CLAIMABLE_STATUSES),
            lte(relationshipContextEmbeddingJobs.runAfter, input.now),
          ),
        )
        .orderBy(asc(relationshipContextEmbeddingJobs.runAfter))
        .limit(1)
        .for("update", { skipLocked: true });

      const [job] = await getDb()
        .update(relationshipContextEmbeddingJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${relationshipContextEmbeddingJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(inArray(relationshipContextEmbeddingJobs.id, nextJob))
        .returning();

      return job ?? null;
    },
    async updateEmbeddingJob(input) {
      const [job] = await getDb()
        .update(relationshipContextEmbeddingJobs)
        .set(buildJobUpdate(input))
        .where(eq(relationshipContextEmbeddingJobs.id, input.jobId))
        .returning();

      if (!job) {
        throw new Error("Embedding job not found.");
      }

      return job;
    },
    async getGeneralActionForEmbedding(input) {
      return selectOwnedGeneralAction(input);
    },
    async getAssetForEmbedding(input) {
      return selectOwnedAsset(input);
    },
    async getAssetMemoryForEmbedding(input) {
      // The memory and its anchor in one read: the embedded text folds in the asset's
      // name and kind, and the embed decision needs the asset's status.
      const [row] = await getDb()
        .select({ memory: assetMemories, asset: assets })
        .from(assetMemories)
        .innerJoin(assets, eq(assets.id, assetMemories.assetId))
        .where(
          and(
            eq(assetMemories.id, input.assetMemoryId),
            eq(assetMemories.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);

      if (!row) {
        return null;
      }

      const { valueJson, ...memory } = row.memory;

      return {
        memory: assetMemorySchema.parse({ ...memory, value: valueJson }),
        asset: assetSchema.parse(row.asset),
      };
    },
    async getSavedItemForEmbedding(input) {
      const [item] = await getDb()
        .select()
        .from(savedItems)
        .where(
          and(eq(savedItems.id, input.savedItemId), eq(savedItems.ownerUserId, input.ownerUserId)),
        )
        .limit(1);
      return item ? savedItemSchema.parse(item) : null;
    },
    async upsertRelationshipContextEmbedding(values) {
      const parsed = createRelationshipContextEmbeddingSchema.parse(values);
      const [embedding] = await getDb()
        .insert(relationshipContextEmbeddings)
        .values(parsed)
        .onConflictDoUpdate({
          target: [
            relationshipContextEmbeddings.ownerUserId,
            relationshipContextEmbeddings.recordKind,
            relationshipContextEmbeddings.recordId,
            relationshipContextEmbeddings.embeddingModel,
            relationshipContextEmbeddings.embeddingVersion,
          ],
          set: {
            personId: parsed.personId,
            embedding: parsed.embedding,
            embeddingDimensions: parsed.embeddingDimensions,
            embeddedText: parsed.embeddedText,
            contentFingerprint: parsed.contentFingerprint,
            trustLevel: parsed.trustLevel,
            sensitivity: parsed.sensitivity,
            sourceUpdatedAt: parsed.sourceUpdatedAt,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!embedding) {
        throw new Error("Failed to upsert relationship-context embedding.");
      }

      return embedding;
    },
    async findRelationshipContextEmbedding(input) {
      const [embedding] = await getDb()
        .select()
        .from(relationshipContextEmbeddings)
        .where(
          and(
            eq(relationshipContextEmbeddings.ownerUserId, input.ownerUserId),
            eq(relationshipContextEmbeddings.recordKind, input.recordKind),
            eq(relationshipContextEmbeddings.recordId, input.recordId),
            eq(relationshipContextEmbeddings.embeddingModel, input.embeddingModel),
            eq(relationshipContextEmbeddings.embeddingVersion, input.embeddingVersion),
          ),
        )
        .limit(1);

      return embedding ?? null;
    },
    async searchSavedItemsSemantic(input) {
      const queryVector = `[${input.queryEmbedding.join(",")}]`;
      const rows = await getDb().execute(sql<SavedItemSemanticSearchRow>`
        select
          si.id::text as saved_item_id,
          si.title,
          e.embedded_text as snippet,
          (1 - (e.embedding <=> ${queryVector}::vector))::float8 as similarity,
          si.status::text as status,
          si.scope::text as scope
        from relationship_context_embeddings e
        inner join saved_items si
          on si.id = e.record_id
          and e.record_kind = 'saved_item'
        where
          e.owner_user_id = si.owner_user_id
          and ${visibleHouseholdRecordSql({
            callerUserId: input.ownerUserId,
            tableAlias: "si",
            recordKind: "saved_item",
          })}
          and (${input.includeArchived}::boolean or si.status = 'active')
          and e.embedding_model = ${input.embeddingModel}
          and e.embedding_version = ${input.embeddingVersion}
          and e.embedding_dimensions = ${input.queryEmbedding.length}
          and e.trust_level = 'saved_context'
          and e.embedded_text = regexp_replace(
            concat_ws(E'\n', btrim(si.title), nullif(btrim(si.content), ''), nullif(btrim(si.url), '')),
            '[ \t]+', ' ', 'g'
          )
          and (1 - (e.embedding <=> ${queryVector}::vector)) >= ${input.minimumSimilarity}
        order by similarity desc, si.updated_at desc, si.id asc
        limit ${input.limit}
      `);
      return (rows as unknown as SavedItemSemanticSearchRow[]).map((row) => ({
        savedItemId: row.saved_item_id,
        title: row.title,
        snippet: row.snippet,
        similarity: Number(row.similarity),
        status: row.status,
        scope: row.scope,
      }));
    },
    async searchSemanticContext(input) {
      const queryVector = `[${input.queryEmbedding.join(",")}]`;
      const rows = await getDb().execute(sql<SemanticMemorySearchRow>`
        select *
        from (
          select
            e.record_kind::text as record_kind,
            e.record_id::text as record_id,
            m.owner_user_id::text as owner_user_id,
            m.household_id::text as household_id,
            m.scope::text as scope,
            p.id::text as related_person_id,
            p.display_name as related_person_display_name,
            e.embedded_text as snippet,
            (1 - (e.embedding <=> ${queryVector}::vector))::float8 as similarity,
            e.trust_level::text as trust_level,
            e.sensitivity::text as sensitivity,
            m.importance as importance,
            m.updated_at as updated_at,
            null::text as general_action_status,
            null::boolean as general_action_is_routine,
            null::text as general_action_area_id
          from relationship_context_embeddings e
          inner join memories m
            on m.id = e.record_id
            and e.record_kind = 'memory'
          inner join people p
            on p.id = m.person_id
            and p.owner_user_id = ${input.ownerUserId}
          where
            e.owner_user_id = m.owner_user_id
            and ${visibleHouseholdRecordSql({
              callerUserId: input.ownerUserId,
              tableAlias: "m",
              recordKind: "memory",
            })}
            and ${kindFilter(input.recordKinds, "memory")}
            and e.record_kind = 'memory'
            and m.status = 'approved'
            and e.embedding_model = ${input.embeddingModel}
            and e.embedding_version = ${input.embeddingVersion}
            and e.embedding_dimensions = ${input.queryEmbedding.length}
            and e.source_updated_at = m.updated_at
            and e.embedded_text = regexp_replace(btrim(m.content), '\\s+', ' ', 'g')
            and e.trust_level = 'confirmed_fact'
            and e.sensitivity = m.sensitivity
            and (${input.personId ? sql`e.person_id = ${input.personId}` : sql`true`})
            and (${input.directlyRequested}::boolean or e.sensitivity <> 'restricted')
            and (1 - (e.embedding <=> ${queryVector}::vector)) >= ${input.minimumSimilarity}
          union all
          select
            e.record_kind::text as record_kind,
            e.record_id::text as record_id,
            sr.owner_user_id::text as owner_user_id,
            sr.household_id::text as household_id,
            sr.scope::text as scope,
            coalesce(filtered_person.id, visible_people.primary_id)::text as related_person_id,
            coalesce(filtered_person.display_name, visible_people.primary_display_name) as related_person_display_name,
            regexp_replace(btrim(sr.content), '[ \t]+', ' ', 'g') as snippet,
            (1 - (e.embedding <=> ${queryVector}::vector))::float8 as similarity,
            e.trust_level::text as trust_level,
            e.sensitivity::text as sensitivity,
            sr.importance as importance,
            sr.updated_at as updated_at,
            null::text as general_action_status,
            null::boolean as general_action_is_routine,
            null::text as general_action_area_id
          from relationship_context_embeddings e
          inner join source_records sr
            on sr.id = e.record_id
            and e.record_kind = 'source_record'
          left join lateral (
            select
              string_agg(btrim(p.display_name), ', ' order by btrim(p.display_name) asc) as display_names,
              (array_agg(p.display_name order by case when srp.role = 'primary' then 0 else 1 end, p.display_name asc, p.id asc))[1] as primary_display_name
            from source_record_people srp
            inner join people p
              on p.id = srp.person_id
            where srp.source_record_id = sr.id
              and btrim(p.display_name) <> ''
          ) related_people on true
          left join lateral (
            select
              (array_agg(p.id order by case when srp.role = 'primary' then 0 else 1 end, p.display_name asc, p.id asc))[1] as primary_id,
              (array_agg(p.display_name order by case when srp.role = 'primary' then 0 else 1 end, p.display_name asc, p.id asc))[1] as primary_display_name
            from source_record_people srp
            inner join people p
              on p.id = srp.person_id
            where srp.source_record_id = sr.id
              and p.owner_user_id = ${input.ownerUserId}
              and btrim(p.display_name) <> ''
          ) visible_people on true
          left join people filtered_person
            on filtered_person.id = ${input.personId ?? null}::uuid
            and filtered_person.owner_user_id = ${input.ownerUserId}
          where
            e.owner_user_id = sr.owner_user_id
            and ${visibleHouseholdRecordSql({
              callerUserId: input.ownerUserId,
              tableAlias: "sr",
              recordKind: "source_record",
            })}
            and ${kindFilter(input.recordKinds, "source_record")}
            and e.record_kind = 'source_record'
            and sr.status = 'active'
            and sr.source_type = 'manual'
            and sr.retention_policy <> 'delete_after_processing'
            and coalesce(sr.metadata_json->>'semanticRetrievalKind', 'note') in ('note', 'interaction_summary')
            and not exists (
              select 1
              from unresolved_person_mentions upm
              where upm.source_record_id = sr.id
                and upm.status = 'unresolved'
            )
            and related_people.display_names is not null
            and e.embedding_model = ${input.embeddingModel}
            and e.embedding_version = ${input.embeddingVersion}
            and e.embedding_dimensions = ${input.queryEmbedding.length}
            and e.source_updated_at = sr.updated_at
            and e.embedded_text = concat_ws(E'\n',
              concat('People: ', related_people.display_names),
              case
                when nullif(btrim(sr.metadata_json->>'interactionType'), '') is not null
                  then concat('Interaction type: ', btrim(sr.metadata_json->>'interactionType'))
                else null
              end,
              concat('Logged context: ', regexp_replace(btrim(sr.content), '[ \t]+', ' ', 'g'))
            )
            and e.trust_level = 'logged_context'
            and e.sensitivity = sr.sensitivity
            and sr.sensitivity <> 'restricted'
            and (${
              input.personId
                ? sql`filtered_person.id is not null and exists (
                    select 1
                    from source_record_people filter_srp
                    where filter_srp.source_record_id = sr.id
                      and filter_srp.person_id = ${input.personId}
                  )`
                : sql`true`
            })
            and (1 - (e.embedding <=> ${queryVector}::vector)) >= ${input.minimumSimilarity}
          union all
          select
            e.record_kind::text as record_kind,
            e.record_id::text as record_id,
            ga.owner_user_id::text as owner_user_id,
            ga.household_id::text as household_id,
            ga.scope::text as scope,
            null::text as related_person_id,
            null::text as related_person_display_name,
            ga.title as snippet,
            (1 - (e.embedding <=> ${queryVector}::vector))::float8 as similarity,
            e.trust_level::text as trust_level,
            e.sensitivity::text as sensitivity,
            0 as importance,
            ga.updated_at as updated_at,
            ga.status::text as general_action_status,
            (ga.recurrence is not null) as general_action_is_routine,
            ga.area_id::text as general_action_area_id
          from relationship_context_embeddings e
          inner join general_actions ga
            on ga.id = e.record_id
            and e.record_kind = 'general_action'
          where
            e.owner_user_id = ga.owner_user_id
            and ${kindFilter(input.recordKinds, "general_action")}
            and e.record_kind = 'general_action'
            -- General Actions are not person-relationship context (ADRs 0143, 0155): a
            -- person-scoped query never returns them.
            and (${input.personId ? sql`false` : sql`true`})
            -- Scope filtering happens here, pre-retrieval (ADR 0153, AC5). This inlines
            -- the domain canRetrieveGeneralAction policy in SQL: a durable action
            -- (open/deferred/paused) is admitted only for a caller who may see it, and a
            -- suggested proposal only in owner-only review context, never scope-visible to
            -- a household member (ADRs 0151-0153, AC3). Ignored and terminal never surface.
            -- The status list is pinned to RETRIEVABLE_GENERAL_ACTION_STATUSES by the
            -- migration-shape string-assertion test.
            and (
              (
                ${visibleHouseholdRecordSql({
                  callerUserId: input.ownerUserId,
                  tableAlias: "ga",
                  recordKind: "general_action",
                })}
                and ga.status in ('open', 'deferred', 'paused')
              )
              or (
                ${input.includeReviewGated}::boolean
                and ga.owner_user_id = ${input.ownerUserId}
                and ga.status = 'suggested'
              )
            )
            and e.embedding_model = ${input.embeddingModel}
            and e.embedding_version = ${input.embeddingVersion}
            and e.embedding_dimensions = ${input.queryEmbedding.length}
            -- No updated_at freshness guard here: a General Action's updated_at bumps on
            -- every lifecycle transition (defer, pause, complete-and-roll-forward) while
            -- its embedded text (title/notes/cadence) is unchanged, so keying on it would
            -- wrongly drop an action from retrieval after a harmless status change. The
            -- content-fingerprint reuse at embed time keeps the vector matched to the last
            -- content edit, and content edits re-enqueue an embedding job; missing or
            -- still-processing embeddings fail open (PRD Phase 1D).
            and e.trust_level = 'action_item'
            and (1 - (e.embedding <=> ${queryVector}::vector)) >= ${input.minimumSimilarity}
        ) mixed_results
        order by
          round(similarity::numeric, 4) desc,
          importance desc,
          updated_at desc,
          record_id asc
        limit ${input.limit}
      `);

      return (rows as unknown as SemanticMemorySearchRow[]).map(toSemanticRetrievalResult);
    },
  };
}

function kindFilter(
  kinds: ("memory" | "source_record" | "general_action")[] | undefined,
  kind: "memory" | "source_record" | "general_action",
) {
  return !kinds || kinds.includes(kind) ? sql`true` : sql`false`;
}

function toSemanticRetrievalResult(row: SemanticMemorySearchRow): SemanticRetrievalResult {
  return {
    recordKind: row.record_kind,
    recordId: row.record_id,
    visibilityChoice: visibilityChoiceForScope(row.scope),
    visibilityLabel: visibilityLabelForScope(row.scope),
    relatedPersonId: row.related_person_id,
    relatedPersonDisplayName: row.related_person_display_name,
    snippet: row.snippet,
    similarity: Number(row.similarity),
    trustLevel: row.trust_level,
    sensitivity: row.sensitivity,
    sourceRefs: [{ kind: row.record_kind, id: row.record_id }],
    routing: {
      personId: row.related_person_id,
      recordKind: row.record_kind,
      recordId: row.record_id,
    },
    generalAction:
      row.record_kind === "general_action" && row.general_action_status
        ? {
            status: row.general_action_status,
            isRoutine: Boolean(row.general_action_is_routine),
            isSuggested: row.general_action_status === "suggested",
            areaId: row.general_action_area_id,
          }
        : null,
  };
}

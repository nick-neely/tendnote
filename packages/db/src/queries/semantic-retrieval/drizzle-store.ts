import {
  assetMemorySchema,
  assetSchema,
  claimableEmbeddingJobStatuses,
  createEmbeddingJobSchema,
  createRelationshipContextEmbeddingSchema,
  type EmbeddingJobStatus,
  type GeneralActionStatus,
  reopenableEmbeddingJobStatuses,
  type SemanticRetrievalResult,
  savedItemSchema,
  visibilityChoiceForScope,
  visibilityLabelForScope,
} from "@tendnote/domain";
import { type AnyColumn, and, asc, eq, inArray, isNull, lte, type SQL, sql } from "drizzle-orm";
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
import {
  type EmbeddingClaimFence,
  type EmbeddingStore,
  type SettleEmbeddingJobInput,
  STALE_EMBEDDING_JOB_RECOVERY_MESSAGE,
  type UpdateEmbeddingJobInput,
} from "./types";

const CLAIMABLE_STATUSES = [...claimableEmbeddingJobStatuses];
const REOPENABLE_STATUSES = [...reopenableEmbeddingJobStatuses];

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

/**
 * A job column, a literal, or a bound value, as an SQL fragment a `case` arm can hold.
 *
 * Two conversions the ordinary `set` path does for free and a hand-built fragment does not.
 * A null becomes the SQL keyword rather than an untyped `$n` Postgres would have to infer a
 * type for. A `Date` becomes an ISO string with an explicit cast, because a parameter
 * inside a `sql` template bypasses drizzle's column mapping and reaches the driver as a raw
 * value it refuses to serialize.
 */
function jobValue(value: Date | string | null | AnyColumn): SQL {
  if (value === null) return sql`null`;
  if (value instanceof Date) return sql`${value.toISOString()}::timestamptz`;

  return sql`${value}`;
}

/** A status as a literal typed for the job table's enum, so a `case` arm can return it. */
function jobStatus(status: EmbeddingJobStatus): SQL {
  return sql`${status}::"public"."embedding_job_status"`;
}

/** Whether the row picked up a rerun request while this run was in flight. */
const RERUN_REQUESTED = sql`${relationshipContextEmbeddingJobs.rerunRequestedAt} is not null`;

/** True of the terminal verdicts a repeat enqueue sends straight back to `pending`. */
const REOPENABLE = inArray(relationshipContextEmbeddingJobs.status, REOPENABLE_STATUSES);

/** True of a job a repeat enqueue can only leave a marker on. */
const RUNNING = eq(relationshipContextEmbeddingJobs.status, "running");

/** The exact running generation a processor-side embedding mutation belongs to. */
function activeClaim(input: EmbeddingClaimFence) {
  return and(
    eq(relationshipContextEmbeddingJobs.id, input.jobId),
    RUNNING,
    input.expectedClaimedAt === null
      ? isNull(relationshipContextEmbeddingJobs.claimedAt)
      : eq(relationshipContextEmbeddingJobs.claimedAt, input.expectedClaimedAt),
  );
}

/**
 * `stands` unless the guard fires, in which case `instead`.
 *
 * Every column {@link EmbeddingStore.reopenEmbeddingJob} and
 * {@link EmbeddingStore.settleEmbeddingJob} touch is conditional on a status or a marker
 * the row holds at write time, and each of them tests that condition again rather than
 * trusting a value read earlier. Postgres evaluates all of these against the pre-update
 * row, so the arms stay consistent with one another within the statement.
 */
function branch(guard: SQL, instead: SQL, stands: SQL): SQL {
  return sql`case when ${guard} then ${instead} else ${stands} end`;
}

/** One job row by id, or null. Shared by the reader and by settle's superseded-pass path. */
async function readEmbeddingJob(jobId: string) {
  const [job] = await getDb()
    .select()
    .from(relationshipContextEmbeddingJobs)
    .where(eq(relationshipContextEmbeddingJobs.id, jobId))
    .limit(1);

  return job ?? null;
}

/** The job mechanics a settle carries through untouched when no rerun marker fires. */
type CarriedJobColumn = "runAfter" | "claimedAt" | "completedAt" | "lastError";

/**
 * What a column holds on the unmarked arm of its branch: the value the caller supplied, or
 * the column's own value where the caller supplied none.
 *
 * `undefined` means "leave it standing" for every one of these keys, which is exactly what
 * the ordinary `set` path does with them - drizzle drops undefined values, so
 * {@link buildJobUpdate} omitting a key and assigning `undefined` to it reach the same row.
 * Reproducing that rule here, once, is what keeps a settle with no marker equal to the
 * plain update it replaces.
 */
function standingValue(input: SettleEmbeddingJobInput, key: CarriedJobColumn): SQL {
  const supplied = input[key];

  return jobValue(supplied === undefined ? relationshipContextEmbeddingJobs[key] : supplied);
}

/**
 * The `set` clause that writes a finished pass's verdict and consumes the rerun marker.
 *
 * A `failed` verdict needs no branch: its retry backoff is already the extra pass a rerun
 * request asks for, so the verdict stands as written and the marker is simply cleared. A
 * `completed` or `skipped` verdict is a statement about the record as the run read it, so a
 * marker turns it into a fresh `pending` job with the run mechanics reset - the same shape
 * a repeat enqueue would have produced had it arrived a moment later.
 *
 * Every mechanic is branched, not just the ones the caller named, because the marked arm
 * has to reset the run being superseded whether or not this verdict mentioned it.
 */
function buildSettleUpdate(input: SettleEmbeddingJobInput) {
  const cleared = { rerunRequestedAt: null, updatedAt: input.now };

  if (input.status === "failed") {
    return { ...buildJobUpdate(input), ...cleared };
  }

  return {
    ...cleared,
    status: branch(RERUN_REQUESTED, jobStatus("pending"), jobStatus(input.status)),
    runAfter: branch(RERUN_REQUESTED, jobValue(input.now), standingValue(input, "runAfter")),
    claimedAt: branch(RERUN_REQUESTED, sql`null`, standingValue(input, "claimedAt")),
    completedAt: branch(RERUN_REQUESTED, sql`null`, standingValue(input, "completedAt")),
    lastError: branch(RERUN_REQUESTED, sql`null`, standingValue(input, "lastError")),
  };
}

type EmbeddingTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type ParsedEmbedding = ReturnType<typeof createRelationshipContextEmbeddingSchema.parse>;

async function withActiveClaim<T>(
  input: EmbeddingClaimFence,
  mutate: (tx: EmbeddingTransaction) => Promise<T>,
): Promise<T | null> {
  return getDb().transaction(async (tx) => {
    const [claim] = await tx
      .select({ id: relationshipContextEmbeddingJobs.id })
      .from(relationshipContextEmbeddingJobs)
      .where(activeClaim(input))
      .limit(1)
      .for("update");

    return claim ? mutate(tx) : null;
  });
}

async function upsertEmbedding(tx: EmbeddingTransaction, parsed: ParsedEmbedding) {
  const [embedding] = await tx
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

  if (!embedding) throw new Error("Failed to upsert relationship-context embedding.");
  return embedding;
}

async function refreshEmbeddingMetadata(
  tx: EmbeddingTransaction,
  input: Parameters<EmbeddingStore["refreshRelationshipContextEmbeddingMetadata"]>[0],
) {
  const [embedding] = await tx
    .update(relationshipContextEmbeddings)
    .set({
      personId: input.personId,
      trustLevel: input.trustLevel,
      sensitivity: input.sensitivity,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(relationshipContextEmbeddings.id, input.embeddingId),
        eq(relationshipContextEmbeddings.ownerUserId, input.ownerUserId),
      ),
    )
    .returning();

  if (!embedding) throw new Error("Relationship-context embedding not found.");
  return embedding;
}

async function deleteRecordEmbeddings(
  tx: EmbeddingTransaction,
  input: Parameters<EmbeddingStore["deleteRelationshipContextEmbeddingsForRecord"]>[0],
) {
  const deleted = await tx
    .delete(relationshipContextEmbeddings)
    .where(
      and(
        eq(relationshipContextEmbeddings.ownerUserId, input.ownerUserId),
        eq(relationshipContextEmbeddings.recordKind, input.recordKind),
        eq(relationshipContextEmbeddings.recordId, input.recordId),
      ),
    )
    .returning({ id: relationshipContextEmbeddings.id });

  return deleted.length;
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
      return readEmbeddingJob(jobId);
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
    async recoverStaleEmbeddingJobs(input) {
      if (input.limit <= 0) return [];

      const staleJobs = getDb()
        .select({ id: relationshipContextEmbeddingJobs.id })
        .from(relationshipContextEmbeddingJobs)
        .where(
          and(
            eq(relationshipContextEmbeddingJobs.status, "running"),
            lte(relationshipContextEmbeddingJobs.claimedAt, input.staleBefore),
          ),
        )
        .orderBy(asc(relationshipContextEmbeddingJobs.claimedAt))
        .limit(input.limit)
        .for("update", { skipLocked: true });

      return getDb()
        .update(relationshipContextEmbeddingJobs)
        .set({
          status: "pending",
          runAfter: input.now,
          lastError: STALE_EMBEDDING_JOB_RECOVERY_MESSAGE,
          claimedAt: null,
          completedAt: null,
          rerunRequestedAt: null,
          updatedAt: input.now,
        })
        .where(inArray(relationshipContextEmbeddingJobs.id, staleJobs))
        .returning();
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
    async reopenEmbeddingJob(input) {
      const columns = relationshipContextEmbeddingJobs;
      const [job] = await getDb()
        .update(columns)
        .set({
          status: branch(REOPENABLE, jobStatus("pending"), jobValue(columns.status)),
          // Only a job that is still running takes the marker. Every other status either is
          // about to run anyway or has just been sent back to `pending` by the arms above,
          // so a marker on it could only be a stale one this clears.
          rerunRequestedAt: branch(RUNNING, jobValue(input.now), sql`null`),
          runAfter: branch(REOPENABLE, jobValue(input.runAfter), jobValue(columns.runAfter)),
          lastError: branch(REOPENABLE, sql`null`, jobValue(columns.lastError)),
          claimedAt: branch(REOPENABLE, sql`null`, jobValue(columns.claimedAt)),
          completedAt: branch(REOPENABLE, sql`null`, jobValue(columns.completedAt)),
          updatedAt: input.now,
        })
        .where(eq(columns.id, input.jobId))
        .returning();

      if (!job) {
        throw new Error("Embedding job not found.");
      }

      return job;
    },
    async settleEmbeddingJob(input) {
      const [job] = await getDb()
        .update(relationshipContextEmbeddingJobs)
        .set(buildSettleUpdate(input))
        .where(
          and(
            eq(relationshipContextEmbeddingJobs.id, input.jobId),
            eq(relationshipContextEmbeddingJobs.status, "running"),
            input.expectedClaimedAt === null
              ? isNull(relationshipContextEmbeddingJobs.claimedAt)
              : eq(relationshipContextEmbeddingJobs.claimedAt, input.expectedClaimedAt),
          ),
        )
        .returning();

      if (job) {
        return { job, settled: true };
      }

      // The row left `running` between this pass reading it and settling, so another pass
      // over the same job settled first and this verdict is superseded. Writing it anyway
      // is what would lose a rerun: the first settle consumes the marker and leaves
      // `pending`, and an unguarded second write puts its own `completed` over the top,
      // stranding the edit that asked for the extra pass.
      //
      // Two passes can genuinely be in flight at once - `claimJobForProcessing` runs a job
      // that is already `running` without re-claiming it, which is how a redelivery makes
      // progress after a worker dies - and both hold the same `claimedAt`, so the status is
      // the only thing that tells the superseded one apart.
      const current = await readEmbeddingJob(input.jobId);

      if (!current) {
        throw new Error("Embedding job not found.");
      }

      return { job: current, settled: false };
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
      return getDb().transaction((tx) => upsertEmbedding(tx, parsed));
    },
    async upsertRelationshipContextEmbeddingForClaim(input) {
      const parsed = createRelationshipContextEmbeddingSchema.parse(input.embedding);
      return withActiveClaim(input.claim, (tx) => upsertEmbedding(tx, parsed));
    },
    async refreshRelationshipContextEmbeddingMetadata(input) {
      return getDb().transaction((tx) => refreshEmbeddingMetadata(tx, input));
    },
    async refreshRelationshipContextEmbeddingMetadataForClaim(input) {
      return withActiveClaim(input.claim, (tx) => refreshEmbeddingMetadata(tx, input));
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
    async deleteRelationshipContextEmbeddingsForRecord(input) {
      // No model/version predicate on purpose: every row for this record goes, because a
      // row left behind under a superseded model still holds the record's text.
      return getDb().transaction((tx) => deleteRecordEmbeddings(tx, input));
    },
    async deleteRelationshipContextEmbeddingsForRecordForClaim(input) {
      const deleted = await withActiveClaim(input.claim, (tx) => deleteRecordEmbeddings(tx, input));
      return deleted === null ? null : { deleted };
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
            -- Staleness is content-addressed, never timestamp-addressed (ADR 0013:
            -- "content_fingerprint should drive staleness"). The embedded-text equality
            -- below is the real guard - it compares the live projected text against the
            -- exact text that was embedded, so a vector can only match a record that
            -- still says what the vector encodes.
            --
            -- An e.source_updated_at = m.updated_at guard used to sit here and silently
            -- emptied this branch. Two independent reasons, both unrecoverable:
            --   1. Precision. memories.updated_at is written by Postgres defaultNow() at
            --      microsecond resolution; source_updated_at is written back from a JS
            --      Date, which the driver truncates to milliseconds. The two are unequal
            --      by construction for any row whose timestamp has sub-millisecond digits
            --      - the row is disqualified the instant it is embedded.
            --   2. Harmless touches. Editing importance or re-approving a memory bumps
            --      updated_at without changing the embedded text, and reuseOrEmbed
            --      short-circuits on a matching fingerprint, so re-enqueueing never
            --      refreshes source_updated_at. The row could never come back.
            -- The general-action branch below already omits this guard for reason 2.
            -- source_updated_at stays on the row as embed-time provenance, not a gate.
            and e.embedded_text = regexp_replace(btrim(m.content), '\\s+', ' ', 'g')
            and e.trust_level = 'confirmed_fact'
            -- Live privacy gating, not redundant bookkeeping. Two write-side mechanisms
            -- already act on a sensitivity edit - reuseOrEmbed converges the denormalized
            -- column, and a memory edited to restricted has its row *deleted* outright by
            -- the embed decision's skip path (restricted text is never re-sent to a
            -- provider, so the row could never be corrected in place). Neither is
            -- synchronous with the edit: this equality is what fails closed across the
            -- window between the edit and its job running, and what still withholds a row
            -- if a future change ever lets one survive the scrub. The gate below reads
            -- e.sensitivity, so the two together are equivalent to gating on
            -- m.sensitivity - which is the point.
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
            -- No e.source_updated_at = sr.updated_at guard, for the same reason as the
            -- memory branch above: it is unsatisfiable by construction (Postgres-microsecond
            -- updated_at vs millisecond-truncated JS Date) and unrecoverable once a
            -- post-embed touch - linking a person, resolving a mention - bumps updated_at
            -- without changing the embedded text. The projection equality below is the real
            -- staleness guard, and it is strictly stronger: it re-derives People /
            -- Interaction type / Logged context from the live rows, so an edit to the
            -- content, the linked people, or the interaction type all invalidate the vector.
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
            -- Kept for the same reason as the memory branch: the write side deletes a
            -- restricted record's row rather than rewriting it (the embed decision skips
            -- it), and this equality is what withholds a row still carrying its
            -- pre-restriction text until that scrub runs.
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
                and (
                  ga.status in ('open', 'deferred', 'paused')
                  or (
                    ${input.includeArchived}::boolean
                    and ga.status in ('completed', 'dismissed', 'archived')
                  )
                )
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

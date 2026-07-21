import { randomUUID } from "node:crypto";
import {
  type Asset,
  type AssetMemory,
  assetMemorySchema,
  assetSchema,
  canRetrieveGeneralAction,
  claimableEmbeddingJobStatuses,
  createAssetMemorySchema,
  createAssetSchema,
  createEmbeddingJobSchema,
  createGeneralActionSchema,
  createRelationshipContextEmbeddingSchema,
  decideGeneralActionEmbedding,
  decideSourceRecordEmbedding,
  type EmbeddingJob,
  type GeneralAction,
  generalActionRetrievalMeta,
  generalActionSchema,
  type HouseholdMembership,
  type Memory,
  projectApprovedMemoryEmbeddedText,
  projectGeneralActionEmbeddedText,
  projectSavedItemEmbeddedText,
  projectSourceRecordEmbeddedText,
  type RelationshipContextEmbedding,
  type SourceRecord,
  visibilityChoiceForScope,
  visibilityLabelForScope,
} from "@tendnote/domain";
import { applyJobUpdateFields } from "../extraction-job-queue/in-memory-queue";
import type { HouseholdRecordShare } from "../households/types";
import { canViewerSeeSeededHouseholdRecord } from "../households/visibility-memory";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import { createInMemorySavedItemRecordStore } from "../saved-items/in-memory-store";
import type { InMemoryEmbeddingStore } from "./types";

const CLAIMABLE_STATUSES = new Set<EmbeddingJob["status"]>(claimableEmbeddingJobStatuses);

/** The parsed request the per-kind embedding matchers operate on. */
type SemanticSearchInput = Parameters<InMemoryEmbeddingStore["searchSemanticContext"]>[0];

export function createInMemoryEmbeddingStore(
  seed: {
    householdMemberships?: HouseholdMembership[];
    householdRecordShares?: HouseholdRecordShare[];
  } = {},
): InMemoryEmbeddingStore {
  const base = createInMemoryMemoryStore();
  const jobs = new Map<string, EmbeddingJob>();
  const embeddings = new Map<string, RelationshipContextEmbedding>();
  const generalActionRecords = new Map<string, GeneralAction>();
  const assetRecords = new Map<string, Asset>();
  const assetMemoryRecords = new Map<string, AssetMemory>();
  const savedItemStore = createInMemorySavedItemRecordStore();
  const savedItemRecords = savedItemStore.records;
  const householdMemberships = seed.householdMemberships ?? [];
  const householdRecordShares = seed.householdRecordShares ?? [];

  function embeddingKey(
    embedding: Pick<
      RelationshipContextEmbedding,
      "ownerUserId" | "recordKind" | "recordId" | "embeddingModel" | "embeddingVersion"
    >,
  ) {
    return [
      embedding.ownerUserId,
      embedding.recordKind,
      embedding.recordId,
      embedding.embeddingModel,
      embedding.embeddingVersion,
    ].join(":");
  }

  function claim(job: EmbeddingJob, now: Date): EmbeddingJob {
    const claimed: EmbeddingJob = {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      claimedAt: now,
      updatedAt: now,
    };

    jobs.set(claimed.id, claimed);

    return claimed;
  }

  return {
    ...base,
    async listSourceRecordPeople(input) {
      const sourceRecord = await base.getSourceRecord({
        ownerUserId: input.ownerUserId,
        sourceRecordId: input.sourceRecordId,
      });

      return sourceRecord ? base.listSourceRecordPeople(input) : [];
    },
    async listUnresolvedMentions(input) {
      const sourceRecord = await base.getSourceRecord({
        ownerUserId: input.ownerUserId,
        sourceRecordId: input.sourceRecordId,
      });

      return sourceRecord ? base.listUnresolvedMentions(input) : [];
    },
    async createEmbeddingJob(values) {
      const parsed = createEmbeddingJobSchema.parse(values);
      const now = new Date();
      const job: EmbeddingJob = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      jobs.set(job.id, job);

      return job;
    },
    async findEmbeddingJobByIdempotencyKey(idempotencyKey) {
      return [...jobs.values()].find((job) => job.idempotencyKey === idempotencyKey) ?? null;
    },
    async getEmbeddingJob(jobId) {
      return jobs.get(jobId) ?? null;
    },
    async claimEmbeddingJob(input) {
      const job = jobs.get(input.jobId);

      if (!job || !CLAIMABLE_STATUSES.has(job.status) || job.runAfter > input.now) {
        return null;
      }

      return claim(job, input.now);
    },
    async claimNextEmbeddingJob(input) {
      const next = [...jobs.values()]
        .filter((job) => CLAIMABLE_STATUSES.has(job.status) && job.runAfter <= input.now)
        .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())[0];

      return next ? claim(next, input.now) : null;
    },
    async updateEmbeddingJob(input) {
      const job = jobs.get(input.jobId);

      if (!job) {
        throw new Error("Embedding job not found.");
      }

      const updated = applyJobUpdateFields(job, input);

      jobs.set(updated.id, updated);

      return updated;
    },
    async createGeneralAction(values) {
      const parsed = createGeneralActionSchema.parse(values);
      const now = new Date();
      const action = generalActionSchema.parse({
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });

      generalActionRecords.set(action.id, action);

      return action;
    },
    async getGeneralActionForEmbedding(input) {
      const action = generalActionRecords.get(input.generalActionId);

      return action && action.ownerUserId === input.ownerUserId ? action : null;
    },
    async createAsset(values) {
      const parsed = createAssetSchema.parse(values);
      const now = new Date();
      const asset = assetSchema.parse({
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });

      assetRecords.set(asset.id, asset);

      return asset;
    },
    async createAssetMemory(values) {
      const parsed = createAssetMemorySchema.parse(values);
      const now = new Date();
      const memory = assetMemorySchema.parse({
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });

      assetMemoryRecords.set(memory.id, memory);

      return memory;
    },
    async getAssetForEmbedding(input) {
      const asset = assetRecords.get(input.assetId);

      return asset && asset.ownerUserId === input.ownerUserId ? asset : null;
    },
    async getAssetMemoryForEmbedding(input) {
      const memory = assetMemoryRecords.get(input.assetMemoryId);
      if (!memory || memory.ownerUserId !== input.ownerUserId) {
        return null;
      }

      const asset = assetRecords.get(memory.assetId);

      return asset ? { memory, asset } : null;
    },
    createSavedItem: savedItemStore.createSavedItem,
    async getSavedItemForEmbedding(input) {
      const item = savedItemRecords.get(input.savedItemId);
      return item?.ownerUserId === input.ownerUserId ? item : null;
    },
    async upsertRelationshipContextEmbedding(values) {
      const parsed = createRelationshipContextEmbeddingSchema.parse(values);
      const existing = embeddings.get(embeddingKey(parsed));
      const now = new Date();
      const embedding: RelationshipContextEmbedding = {
        ...parsed,
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      embeddings.set(embeddingKey(embedding), embedding);

      return embedding;
    },
    async findRelationshipContextEmbedding(input) {
      return embeddings.get(embeddingKey(input)) ?? null;
    },
    async searchSemanticContext(input) {
      const kinds = new Set(input.recordKinds ?? ["memory", "source_record", "general_action"]);
      const results = await Promise.all(
        [...embeddings.values()].map((embedding) => matchEmbedding(embedding, input, kinds)),
      );

      return results
        .filter((result): result is NonNullable<typeof result> => Boolean(result))
        .sort(compareSemanticResults)
        .slice(0, input.limit)
        .map(({ tieBreakers: _tieBreakers, ...result }) => result);
    },
    async searchSavedItemsSemantic(input) {
      return [...embeddings.values()]
        .filter((embedding) => {
          if (embedding.recordKind !== "saved_item") return false;
          if (embedding.embeddingModel !== input.embeddingModel) return false;
          if (embedding.embeddingVersion !== input.embeddingVersion) return false;
          if (embedding.embeddingDimensions !== input.queryEmbedding.length) return false;
          const item = savedItemRecords.get(embedding.recordId);
          if (!item || item.ownerUserId !== embedding.ownerUserId) return false;
          if (!input.includeArchived && item.status !== "active") return false;
          if (!canViewerSeeRecord(input.ownerUserId, item, "saved_item")) return false;
          if (embedding.trustLevel !== "saved_context") return false;
          return projectSavedItemEmbeddedText(item) === embedding.embeddedText;
        })
        .flatMap((embedding) => {
          const item = savedItemRecords.get(embedding.recordId);
          return item
            ? [
                {
                  savedItemId: item.id,
                  title: item.title,
                  snippet: embedding.embeddedText,
                  similarity: cosineSimilarity(input.queryEmbedding, embedding.embedding),
                  status: item.status,
                  scope: item.scope,
                  updatedAt: item.updatedAt,
                },
              ]
            : [];
        })
        .filter((result) => result.similarity >= input.minimumSimilarity)
        .sort(
          (left, right) =>
            right.similarity - left.similarity ||
            right.updatedAt.getTime() - left.updatedAt.getTime() ||
            left.savedItemId.localeCompare(right.savedItemId),
        )
        .slice(0, input.limit)
        .map(({ updatedAt: _updatedAt, ...result }) => result);
    },
    async listEmbeddingJobs() {
      return [...jobs.values()];
    },
    async listRelationshipContextEmbeddings() {
      return [...embeddings.values()];
    },
  };

  /**
   * Cheap, kind-agnostic gate every embedding must clear before its per-kind matcher
   * runs: the requested record kinds, the exact model/version/vector-dimensions the
   * query was embedded with, and the restricted-sensitivity guard.
   */
  function passesCommonEmbeddingFilters(
    embedding: RelationshipContextEmbedding,
    input: SemanticSearchInput,
    kinds: Set<string>,
  ): boolean {
    if (!kinds.has(embedding.recordKind)) return false;
    if (embedding.embeddingModel !== input.embeddingModel) return false;
    if (embedding.embeddingVersion !== input.embeddingVersion) return false;
    if (embedding.embeddingDimensions !== input.queryEmbedding.length) return false;
    return !(embedding.sensitivity === "restricted" && !input.directlyRequested);
  }

  /** Load a person by id under the owner scope, or null when there is no id to resolve. */
  async function resolvePerson(ownerUserId: string, personId: string | null | undefined) {
    return personId ? await base.getPerson({ ownerUserId, personId }) : null;
  }

  /** The result's related-person fields, without per-call optional-chaining noise. */
  function relatedPersonFields(person: { id: string; displayName: string } | null) {
    if (!person) return { relatedPersonId: null, relatedPersonDisplayName: null };
    return { relatedPersonId: person.id, relatedPersonDisplayName: person.displayName };
  }

  /** Route one embedding to its per-kind matcher, or drop it before that work. */
  async function matchEmbedding(
    embedding: RelationshipContextEmbedding,
    input: SemanticSearchInput,
    kinds: Set<string>,
  ) {
    if (!passesCommonEmbeddingFilters(embedding, input, kinds)) return null;
    if (embedding.recordKind === "general_action") {
      return matchGeneralActionEmbedding(embedding, input);
    }
    if (embedding.recordKind === "source_record") {
      return matchSourceRecordEmbedding(embedding, input);
    }
    return matchMemoryEmbedding(embedding, input);
  }

  /**
   * Whether a durable action is retrievable for this query. General Actions are not
   * person-relationship context (ADRs 0143, 0155), so a person-scoped query never
   * returns them; the shared retrieval gate (ADRs 0151-0153) admits a durable action
   * only to a caller who may see it under scope rules, and a `suggested` proposal only
   * in owner-only review. Content freshness (projection match) is checked separately —
   * unlike the drizzle store (which cannot rebuild the projection in SQL), the
   * in-memory store keeps that stricter check; there is no updated_at guard because a
   * status transition bumps updated_at without changing the embedded text.
   */
  function isGeneralActionEmbeddingRetrievable(
    embedding: RelationshipContextEmbedding,
    action: GeneralAction,
    input: SemanticSearchInput,
  ): boolean {
    if (decideGeneralActionEmbedding(action).action === "skip") return false;
    if (projectGeneralActionEmbeddedText(action) !== embedding.embeddedText) return false;
    return canRetrieveGeneralAction({
      status: action.status,
      ownerUserId: action.ownerUserId,
      callerUserId: input.ownerUserId,
      scopeVisible: canViewerSeeRecord(input.ownerUserId, action, "general_action"),
      includeReviewGated: Boolean(input.includeReviewGated),
    });
  }

  function matchGeneralActionEmbedding(
    embedding: RelationshipContextEmbedding,
    input: SemanticSearchInput,
  ) {
    if (input.personId) return null;
    if (embedding.trustLevel !== "action_item") return null;

    const action = generalActionRecords.get(embedding.recordId);
    if (!action || action.ownerUserId !== embedding.ownerUserId) return null;
    if (!isGeneralActionEmbeddingRetrievable(embedding, action, input)) return null;

    const similarity = cosineSimilarity(input.queryEmbedding, embedding.embedding);
    if (similarity < input.minimumSimilarity) return null;

    return {
      recordKind: "general_action" as const,
      recordId: embedding.recordId,
      visibilityChoice: visibilityChoiceForScope(action.scope),
      visibilityLabel: visibilityLabelForScope(action.scope),
      relatedPersonId: null,
      relatedPersonDisplayName: null,
      snippet: action.title,
      similarity,
      trustLevel: embedding.trustLevel,
      sensitivity: embedding.sensitivity,
      sourceRefs: [{ kind: "general_action" as const, id: embedding.recordId }],
      routing: {
        personId: null,
        recordKind: "general_action" as const,
        recordId: embedding.recordId,
      },
      generalAction: generalActionRetrievalMeta(action),
      tieBreakers: {
        importance: 0,
        updatedAt: action.updatedAt,
      },
    };
  }

  /** Resolve the linked, viewer-visible people for a source record (id + name only). */
  async function sourceRecordPeople(sourceRecord: SourceRecord) {
    const links = await base.listSourceRecordPeople({ sourceRecordId: sourceRecord.id });
    const people = await Promise.all(
      links.map((link) =>
        base.getPerson({ ownerUserId: sourceRecord.ownerUserId, personId: link.personId }),
      ),
    );
    return people
      .filter((person): person is NonNullable<typeof person> => Boolean(person))
      .map((person) => ({ id: person.id, displayName: person.displayName }));
  }

  /**
   * Freshness/eligibility gate for a logged source record: the embedding decision must
   * still say "embed", and the projected text, sensitivity, and source timestamp must
   * all still match the persisted embedding (a stale embedding is skipped).
   */
  async function isSourceRecordEmbeddingFresh(
    embedding: RelationshipContextEmbedding,
    sourceRecord: SourceRecord,
    people: { id: string; displayName: string }[],
  ): Promise<boolean> {
    const unresolvedMentions = await base.listUnresolvedMentions({
      sourceRecordId: sourceRecord.id,
    });
    const unresolvedMentionCount = unresolvedMentions.filter(
      (mention) => mention.status === "unresolved",
    ).length;
    if (decideSourceRecordEmbedding(sourceRecord, people, unresolvedMentionCount).action === "skip")
      return false;
    if (sourceRecord.sensitivity !== embedding.sensitivity) return false;
    if (projectSourceRecordEmbeddedText(sourceRecord, people) !== embedding.embeddedText)
      return false;
    return sourceRecord.updatedAt.getTime() === embedding.sourceUpdatedAt.getTime();
  }

  async function matchSourceRecordEmbedding(
    embedding: RelationshipContextEmbedding,
    input: SemanticSearchInput,
  ) {
    if (embedding.trustLevel !== "logged_context") return null;

    const sourceRecord = await base.getSourceRecord({
      ownerUserId: embedding.ownerUserId,
      sourceRecordId: embedding.recordId,
    });
    if (!sourceRecord) return null;
    if (!canViewerSeeRecord(input.ownerUserId, sourceRecord, "source_record")) return null;

    const people = await sourceRecordPeople(sourceRecord);
    if (input.personId && !people.some((person) => person.id === input.personId)) return null;
    if (!(await isSourceRecordEmbeddingFresh(embedding, sourceRecord, people))) return null;

    const similarity = cosineSimilarity(input.queryEmbedding, embedding.embedding);
    if (similarity < input.minimumSimilarity) return null;

    const resultPersonId = input.personId ?? embedding.personId;
    const person = await resolvePerson(input.ownerUserId, resultPersonId);

    return {
      recordKind: "source_record" as const,
      recordId: embedding.recordId,
      visibilityChoice: visibilityChoiceForScope(sourceRecord.scope),
      visibilityLabel: visibilityLabelForScope(sourceRecord.scope),
      ...relatedPersonFields(person),
      snippet: sourceRecord.content,
      similarity,
      trustLevel: embedding.trustLevel,
      sensitivity: embedding.sensitivity,
      sourceRefs: [{ kind: "source_record" as const, id: embedding.recordId }],
      routing: {
        personId: resultPersonId,
        recordKind: "source_record" as const,
        recordId: embedding.recordId,
      },
      generalAction: null,
      tieBreakers: {
        importance: sourceRecord.importance,
        updatedAt: sourceRecord.updatedAt,
      },
    };
  }

  /**
   * Freshness/eligibility gate for an approved memory: it must be approved, viewer
   * visible, not restricted (unless directly requested), and its sensitivity, projected
   * text, and source timestamp must still match the persisted embedding.
   */
  function isMemoryEmbeddingFresh(
    embedding: RelationshipContextEmbedding,
    memory: Memory,
    input: SemanticSearchInput,
  ): boolean {
    if (memory.status !== "approved") return false;
    if (!canViewerSeeRecord(input.ownerUserId, memory, "memory")) return false;
    if (memory.sensitivity === "restricted" && !input.directlyRequested) return false;
    if (memory.sensitivity !== embedding.sensitivity) return false;
    if (projectApprovedMemoryEmbeddedText(memory) !== embedding.embeddedText) return false;
    return memory.updatedAt.getTime() === embedding.sourceUpdatedAt.getTime();
  }

  async function matchMemoryEmbedding(
    embedding: RelationshipContextEmbedding,
    input: SemanticSearchInput,
  ) {
    if (input.personId && embedding.personId !== input.personId) return null;
    if (embedding.trustLevel !== "confirmed_fact") return null;

    const memory = await base.getMemory({
      ownerUserId: embedding.ownerUserId,
      memoryId: embedding.recordId,
    });
    if (!memory || !isMemoryEmbeddingFresh(embedding, memory, input)) return null;

    const similarity = cosineSimilarity(input.queryEmbedding, embedding.embedding);
    if (similarity < input.minimumSimilarity) return null;

    const person = await resolvePerson(input.ownerUserId, embedding.personId);

    return {
      recordKind: "memory" as const,
      recordId: embedding.recordId,
      visibilityChoice: visibilityChoiceForScope(memory.scope),
      visibilityLabel: visibilityLabelForScope(memory.scope),
      ...relatedPersonFields(person),
      snippet: embedding.embeddedText,
      similarity,
      trustLevel: embedding.trustLevel,
      sensitivity: embedding.sensitivity,
      sourceRefs: [{ kind: "memory" as const, id: embedding.recordId }],
      routing: {
        personId: embedding.personId,
        recordKind: "memory" as const,
        recordId: embedding.recordId,
      },
      generalAction: null,
      tieBreakers: {
        importance: memory.importance,
        updatedAt: memory.updatedAt,
      },
    };
  }

  function canViewerSeeRecord(
    callerUserId: string,
    record: {
      id: string;
      ownerUserId: string;
      householdId?: string | null;
      scope: "private" | "shared" | "household";
    },
    recordKind: "memory" | "source_record" | "general_action" | "saved_item",
  ) {
    return canViewerSeeSeededHouseholdRecord({
      callerUserId,
      record,
      recordKind,
      householdMemberships,
      householdRecordShares,
    });
  }
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  const leftMagnitude = Math.hypot(...left);
  const rightMagnitude = Math.hypot(...right);

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (leftMagnitude * rightMagnitude);
}

type InMemorySemanticResult = Awaited<
  ReturnType<InMemoryEmbeddingStore["searchSemanticContext"]>
>[number] & {
  tieBreakers: {
    importance: number;
    updatedAt: Date;
  };
};

function compareSemanticResults(left: InMemorySemanticResult, right: InMemorySemanticResult) {
  const similarityBucketDelta =
    similarityBucket(right.similarity) - similarityBucket(left.similarity);
  if (similarityBucketDelta !== 0) return similarityBucketDelta;

  return (
    right.tieBreakers.importance - left.tieBreakers.importance ||
    right.tieBreakers.updatedAt.getTime() - left.tieBreakers.updatedAt.getTime() ||
    left.recordId.localeCompare(right.recordId)
  );
}

function similarityBucket(similarity: number) {
  // Mirrors the drizzle adapter's primary sort key `round(similarity::numeric, 4)`:
  // both bucket similarity to 4 decimals before tie-breaking, so the two adapters
  // order identically. The scale (×10_000 here vs decimal rounding in SQL) is just a
  // representation difference — the comparison order is the same, not drifted.
  return Math.round(similarity * 10_000);
}

import type {
  GeneralAction,
  HouseholdMembership,
  Memory,
  Sensitivity,
  SourceRecord,
} from "@tendnote/domain";
import type { HouseholdRecordShare } from "../households/types";
import { createInMemoryEmbeddingStore } from "./in-memory-store";
import { createEmbeddingProcessor } from "./processor";
import type { EmbeddingAdapter, EmbeddingConfig } from "./types";

export const OWNER = "user-1";
export const OTHER_OWNER = "user-2";
export const EMBEDDING_CONFIG: EmbeddingConfig = {
  model: "fake-semantic-retrieval",
  version: "v1",
};

export function createHarness(
  input: {
    adapter?: EmbeddingAdapter;
    config?: EmbeddingConfig;
    householdMemberships?: HouseholdMembership[];
    householdRecordShares?: HouseholdRecordShare[];
  } = {},
) {
  const store = createInMemoryEmbeddingStore({
    householdMemberships: input.householdMemberships,
    householdRecordShares: input.householdRecordShares,
  });
  const adapter =
    input.adapter ??
    ({
      async embedText(request) {
        return {
          vector: [0.1, 0.2, 0.3, 0.4],
          model: request.model,
          version: request.version,
        };
      },
    } satisfies EmbeddingAdapter);
  const processor = createEmbeddingProcessor(store, adapter, input.config ?? EMBEDDING_CONFIG);

  async function createPerson(displayName = "Mara Lin", ownerUserId = OWNER) {
    return store.createPerson({
      ownerUserId,
      displayName,
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
  }

  async function createSourceRecord(
    input: Partial<Omit<SourceRecord, "id" | "createdAt" | "updatedAt">> & {
      ownerUserId?: string;
    } = {},
  ) {
    return store.createSourceRecord({
      ownerUserId: input.ownerUserId ?? OWNER,
      sourceType: input.sourceType ?? "manual",
      content: input.content ?? "Mara prefers handmade cooking gifts.",
      rawContent: input.rawContent ?? "Raw provider text should not be embedded.",
      retentionPolicy: input.retentionPolicy ?? "retain",
      status: input.status ?? "active",
      confidence: input.confidence ?? "medium",
      sensitivity: input.sensitivity ?? "normal",
      scope: input.scope ?? "private",
      importance: input.importance ?? 3,
      metadataJson: input.metadataJson ?? {},
    });
  }

  async function linkSourceRecord(sourceRecordId: string, personId: string) {
    return store.linkSourceRecordPerson({
      sourceRecordId,
      personId,
      role: "primary",
    });
  }

  async function createApprovedMemory(
    overrides: Partial<Memory> & { ownerUserId?: string; sensitivity?: Sensitivity } = {},
  ) {
    const ownerUserId = overrides.ownerUserId ?? OWNER;
    const person = await createPerson("Mara Lin", ownerUserId);
    const sourceRecord = await createSourceRecord({ ownerUserId });

    return store.createMemory({
      personId: person.id,
      ownerUserId,
      sourceRecordId: sourceRecord.id,
      memoryType: "gift_idea",
      content: "Mara prefers handmade cooking gifts.",
      status: "approved",
      importance: 3,
      sensitivity: overrides.sensitivity ?? "normal",
      confidence: "high",
      scope: "private",
      approvedAt: new Date("2026-06-26T00:00:00Z"),
      dismissedAt: null,
      ...overrides,
    });
  }

  async function createGeneralAction(
    input: Partial<Omit<GeneralAction, "id" | "createdAt" | "updatedAt">> & {
      ownerUserId?: string;
    } = {},
  ) {
    return store.createGeneralAction({
      ownerUserId: input.ownerUserId ?? OWNER,
      title: input.title ?? "Replace the refrigerator water filter",
      notes: input.notes ?? null,
      links: input.links ?? [],
      assetHints: input.assetHints ?? [],
      status: input.status ?? "open",
      dueAt: input.dueAt ?? null,
      deferUntil: input.deferUntil ?? null,
      recurrence: input.recurrence ?? null,
      sourceRecordId: input.sourceRecordId ?? null,
      areaId: input.areaId ?? null,
      scope: input.scope ?? "private",
      householdId: input.householdId ?? null,
      createdByUserId: input.createdByUserId ?? input.ownerUserId ?? OWNER,
      lastActorUserId: input.lastActorUserId ?? input.ownerUserId ?? OWNER,
      completedAt: input.completedAt ?? null,
    });
  }

  async function embedGeneralAction(actionId: string, ownerUserId = OWNER) {
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId,
      recordKind: "general_action",
      recordId: actionId,
    });
    return processor.processEmbeddingJob({ jobId: job.id });
  }

  async function auditActions() {
    const entries = await store.listAuditLogEntries({ ownerUserId: OWNER });
    return entries.map((entry) => entry.action);
  }

  return {
    store,
    processor,
    createPerson,
    createSourceRecord,
    linkSourceRecord,
    createApprovedMemory,
    createGeneralAction,
    embedGeneralAction,
    auditActions,
  };
}

import type { Memory, Sensitivity } from "@tendnote/domain";
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
  input: { adapter?: EmbeddingAdapter; config?: EmbeddingConfig } = {},
) {
  const store = createInMemoryEmbeddingStore();
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

  async function createSourceRecord(ownerUserId = OWNER) {
    return store.createSourceRecord({
      ownerUserId,
      sourceType: "manual",
      content: "Mara prefers handmade cooking gifts.",
      rawContent: "Raw provider text should not be embedded.",
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
  }

  async function createApprovedMemory(
    overrides: Partial<Memory> & { ownerUserId?: string; sensitivity?: Sensitivity } = {},
  ) {
    const ownerUserId = overrides.ownerUserId ?? OWNER;
    const person = await createPerson("Mara Lin", ownerUserId);
    const sourceRecord = await createSourceRecord(ownerUserId);

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

  async function auditActions() {
    const entries = await store.listAuditLogEntries({ ownerUserId: OWNER });
    return entries.map((entry) => entry.action);
  }

  return { store, processor, createPerson, createSourceRecord, createApprovedMemory, auditActions };
}

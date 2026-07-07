import type {
  PrivacyScope,
  Sensitivity,
  SourceRecordStatus,
  SuggestedActionExtractionAdapter,
} from "@tendnote/domain";
import { createGeneralActionAreaManager } from "../general-action-areas/lifecycle";
import type { GeneralActionEmbeddingScheduler } from "../general-actions/types";
import { createInMemoryActionExtractionJobStore } from "./in-memory-store";
import { createActionExtractionProcessor } from "./processor";

/**
 * Shared in-memory setup for the action extraction processor tests. Proposals flow
 * through the real in-memory General Action lifecycle store, so tests assert externally
 * observable behaviour — persisted Suggested General Actions, their scope and grounding,
 * job state — without touching internals (ADR 0001/0019).
 */
export const OWNER = "user-1";

export function createHarness(
  input: {
    extractionAdapter?: SuggestedActionExtractionAdapter;
    scheduleGeneralActionEmbedding?: GeneralActionEmbeddingScheduler;
  } = {},
) {
  const store = createInMemoryActionExtractionJobStore();
  const processor = createActionExtractionProcessor(store, {
    extractionAdapter: input.extractionAdapter,
    scheduleGeneralActionEmbedding: input.scheduleGeneralActionEmbedding,
  });
  const areas = createGeneralActionAreaManager(store);

  async function createPerson(displayName: string) {
    return store.createPerson({
      ownerUserId: OWNER,
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

  async function captureRecord(
    overrides: {
      content?: string;
      sensitivity?: Sensitivity;
      status?: SourceRecordStatus;
      scope?: PrivacyScope;
      householdId?: string | null;
      metadataJson?: Record<string, unknown>;
    } = {},
  ) {
    return store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content:
        overrides.content ?? "Fridge filter is due — replace it and set a reminder every 6 months.",
      rawContent: null,
      retentionPolicy: "retain",
      status: overrides.status ?? "active",
      confidence: "medium",
      sensitivity: overrides.sensitivity ?? "normal",
      scope: overrides.scope ?? "private",
      householdId: overrides.householdId ?? null,
      importance: 3,
      metadataJson: overrides.metadataJson ?? {},
    });
  }

  async function linkPerson(sourceRecordId: string, personId: string) {
    await store.linkSourceRecordPerson({ sourceRecordId, personId, role: "primary" });
  }

  async function listActionsForSource(sourceRecordId: string) {
    return store.listGeneralActionsForSourceRecord({ ownerUserId: OWNER, sourceRecordId });
  }

  return {
    store,
    processor,
    areas,
    createPerson,
    captureRecord,
    linkPerson,
    listActionsForSource,
  };
}

/** Enqueue a source record's action extraction job and process it in one step. */
export async function enqueueAndProcess(
  processor: ReturnType<typeof createHarness>["processor"],
  sourceRecordId: string,
) {
  const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId });
  return processor.processActionExtractionJob({ jobId: job.id });
}

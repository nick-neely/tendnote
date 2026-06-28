import type {
  Sensitivity,
  SourceRecordStatus,
  SuggestedMemoryExtractionAdapter,
} from "@tendnote/domain";
import { createSourceRecordCapture } from "../source-records/capture";
import { createSourceRecordResolution } from "../source-records/resolution";
import { createInMemoryExtractionJobStore } from "./in-memory-store";
import { createExtractionProcessor } from "./processor";

/**
 * Shared in-memory setup for the extraction-job processor tests. The store seam
 * (ADR 0001/0019) lets every test assert externally observable behaviour —
 * persisted memories, job state, audit actions — without touching internals.
 */
export const OWNER = "user-1";

export function createHarness(
  input: { extractionAdapter?: SuggestedMemoryExtractionAdapter } = {},
) {
  const store = createInMemoryExtractionJobStore();
  const processor = createExtractionProcessor(store, {
    extractionAdapter: input.extractionAdapter,
  });
  const capture = createSourceRecordCapture(store);
  const resolution = createSourceRecordResolution(store);

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

  async function captureRecord(input: {
    retainedContent: string;
    sensitivity?: Sensitivity;
    status?: SourceRecordStatus;
  }) {
    const { sourceRecord } = await capture.captureSourceRecord({
      ownerUserId: OWNER,
      retainedContent: input.retainedContent,
      sensitivity: input.sensitivity,
      status: input.status ?? "active",
    });

    return sourceRecord;
  }

  async function link(sourceRecordId: string, personId: string) {
    await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: OWNER,
      sourceRecordId,
      personId,
      role: "primary",
    });
  }

  async function auditActions() {
    const entries = await store.listAuditLogEntries({ ownerUserId: OWNER });
    return entries.map((entry) => entry.action);
  }

  async function auditEntries() {
    return store.listAuditLogEntries({ ownerUserId: OWNER });
  }

  return {
    store,
    processor,
    capture,
    resolution,
    createPerson,
    captureRecord,
    link,
    auditActions,
    auditEntries,
  };
}

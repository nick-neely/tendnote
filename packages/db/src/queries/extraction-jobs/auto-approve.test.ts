import {
  SOURCE_RECORD_AUTO_APPROVE_KEY,
  type SuggestedMemoryExtractionAdapter,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createHarness, OWNER } from "./harness";

const oneCandidateAdapter: SuggestedMemoryExtractionAdapter = {
  kind: "fake",
  promptVersion: "test.v1",
  async extractCandidates(input) {
    return {
      candidates: [
        {
          personId: input.resolvedPeople[0]?.id ?? "",
          content: "Mark is considering a move to Denver.",
          memoryType: "life_event",
          importance: 4,
          confidence: "high",
          sensitivity: "normal",
        },
      ],
    };
  },
};

describe("extraction auto-approves memories from a pre-approved note", () => {
  it("saves extracted memories as confirmed (not suggested) and schedules their embedding", async () => {
    const scheduled: Array<{ recordId: string }> = [];
    const { store, processor, createPerson, captureRecord, link, auditActions } = createHarness({
      extractionAdapter: oneCandidateAdapter,
      async scheduleApprovedMemoryEmbedding(input) {
        scheduled.push(input);
      },
    });
    const mark = await createPerson("Mark");
    const note = await captureRecord({ retainedContent: "Messy raw note about Mark." });
    await link(note.id, mark.id);

    // The user pre-approved the note inline before extraction ran.
    await store.updateSourceRecordMetadata({
      ownerUserId: OWNER,
      sourceRecordId: note.id,
      metadataJson: { [SOURCE_RECORD_AUTO_APPROVE_KEY]: true },
    });

    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: note.id });
    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories).toHaveLength(1);
    expect(result.suggestedMemories[0]).toMatchObject({
      personId: mark.id,
      sourceRecordId: note.id,
      status: "approved",
    });
    expect(result.suggestedMemories[0]?.approvedAt).toBeInstanceOf(Date);

    expect(scheduled).toEqual([
      expect.objectContaining({ recordId: result.suggestedMemories[0]?.id, recordKind: "memory" }),
    ]);

    const actions = await auditActions();
    expect(actions).toContain("memory.auto_approved");
    expect(actions).not.toContain("memory.suggest");
  });

  it("still creates tentative suggestions for a note that was not pre-approved", async () => {
    const scheduled: unknown[] = [];
    const { processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: oneCandidateAdapter,
      async scheduleApprovedMemoryEmbedding(input) {
        scheduled.push(input);
      },
    });
    const mark = await createPerson("Mark");
    const note = await captureRecord({ retainedContent: "Messy raw note about Mark." });
    await link(note.id, mark.id);

    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: note.id });
    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.suggestedMemories[0]?.status).toBe("suggested");
    // Suggested memories are not embedded until reviewed.
    expect(scheduled).toEqual([]);
  });
});

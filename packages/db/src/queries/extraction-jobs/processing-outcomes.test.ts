import type { SuggestedMemoryExtractionAdapter } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createHarness, OWNER } from "./harness";

describe("extraction job suggested-memory creation", () => {
  it("uses an injected extraction adapter to create suggested memories", async () => {
    const adapter: SuggestedMemoryExtractionAdapter = {
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
    const { processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: adapter,
    });
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({ retainedContent: "Messy raw note about Mark." });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories).toHaveLength(1);
    expect(result.suggestedMemories[0]).toMatchObject({
      personId: mark.id,
      sourceRecordId: sourceRecord.id,
      content: "Mark is considering a move to Denver.",
      memoryType: "life_event",
      importance: 4,
      confidence: "high",
      sensitivity: "normal",
      status: "suggested",
    });
  });

  it("rejects adapter candidates for unresolved people", async () => {
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      async extractCandidates() {
        return {
          candidates: [
            {
              personId: "unresolved-person",
              content: "Do not persist this.",
              memoryType: "context",
            },
          ],
        };
      },
    };
    const { store, processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: adapter,
    });
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({ retainedContent: "Mark and unknown Jordan." });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories).toHaveLength(0);
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toEqual([]);
  });

  it("creates a suggested memory tied to the person and source record, then completes", async () => {
    const { store, processor, createPerson, captureRecord, link, auditActions } = createHarness();
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({ retainedContent: "Mark may be switching jobs." });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.job.status).toBe("completed");
    expect(result.job.completedAt).not.toBeNull();
    expect(result.suggestedMemories).toHaveLength(1);

    const memory = result.suggestedMemories[0];
    expect(memory?.status).toBe("suggested");
    expect(memory?.personId).toBe(mark.id);
    expect(memory?.sourceRecordId).toBe(sourceRecord.id);
    expect(memory?.content).toBe("Mark may be switching jobs.");

    const persisted = await store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id });
    expect(persisted).toHaveLength(1);

    const actions = await auditActions();
    expect(actions).toContain("memory.suggest");
    expect(actions).toContain("extraction_job.completed");
  });

  it("does not treat suggested memories as durable facts (kept out of approved retrieval)", async () => {
    const { store, processor, createPerson, captureRecord, link } = createHarness();
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({ retainedContent: "Mark likes trail running." });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    await processor.processExtractionJob({ jobId: job.id });

    await expect(
      store.listApprovedMemoriesForPerson({ ownerUserId: OWNER, personId: mark.id }),
    ).resolves.toEqual([]);
  });
});

describe("extraction job skip and delay policy", () => {
  it("skips restricted content from proactive extraction", async () => {
    const { store, processor, createPerson, captureRecord, link, auditActions } = createHarness();
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({
      retainedContent: "Mark is going through a hard diagnosis.",
      sensitivity: "restricted",
    });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("restricted_content");
    expect(result.job.status).toBe("skipped");
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toEqual([]);
    await expect(auditActions()).resolves.toContain("extraction_job.skipped");
  });

  it("extracts restricted content when directly requested and allowed", async () => {
    const { processor, createPerson, captureRecord, link } = createHarness();
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({
      retainedContent: "Mark is moving in August.",
      sensitivity: "restricted",
    });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({
      jobId: job.id,
      directlyRequested: true,
    });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories).toHaveLength(1);
  });

  it("delays a pending personless record that still has unresolved mentions", async () => {
    const { processor, capture, auditActions } = createHarness();
    const { sourceRecord } = await capture.captureSourceRecord({
      ownerUserId: OWNER,
      retainedContent: "Someone named Quinn might be worth tracking.",
      status: "active",
      unresolvedMentions: [{ mentionText: "Quinn", candidatePersonIds: [] }],
    });
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("delayed");
    expect(result.reason).toBe("awaiting_mention_resolution");
    expect(result.job.status).toBe("pending");
    expect(result.job.runAfter.getTime()).toBeGreaterThan(Date.now());
    await expect(auditActions()).resolves.toContain("extraction_job.delayed");
  });

  it("skips an active record with no linked people and nothing to resolve", async () => {
    const { processor, captureRecord } = createHarness();
    const sourceRecord = await captureRecord({ retainedContent: "Generic note with no person." });
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("no_linked_people");
  });
});

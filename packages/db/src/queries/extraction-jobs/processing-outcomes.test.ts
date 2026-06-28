import type {
  SuggestedMemoryExtractionAdapter,
  SuggestedMemoryExtractionInput,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
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
    const { processor, createPerson, captureRecord, link, auditActions, auditEntries } =
      createHarness({
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
    const actions = await auditActions();
    expect(actions).toContain("memory.suggest");
    expect(actions).toContain("extraction_job.completed");
    const memorySuggest = (await auditEntries()).find((entry) => entry.action === "memory.suggest");
    expect(memorySuggest?.metadataJson).toMatchObject({
      adapterKind: "fake",
      promptVersion: "test.v1",
      sourceRecordId: sourceRecord.id,
      extractionJobId: job.id,
      personId: mark.id,
      candidateCount: 1,
      invalidCandidateCount: 0,
      rejectedCandidateCount: 0,
    });
  });

  it("persists valid candidate metadata and the stricter sensitivity", async () => {
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      async extractCandidates(input) {
        return {
          candidates: [
            {
              personId: input.resolvedPeople[0]?.id ?? "",
              content: "Mark prefers early morning calls.",
              memoryType: "preference",
              importance: 5,
              confidence: "high",
              sensitivity: "restricted",
            },
          ],
        };
      },
    };
    const { processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: adapter,
    });
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({
      retainedContent: "Mark likes morning calls.",
      sensitivity: "normal",
    });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.suggestedMemories[0]).toMatchObject({
      personId: mark.id,
      content: "Mark prefers early morning calls.",
      memoryType: "preference",
      importance: 5,
      confidence: "high",
      sensitivity: "restricted",
      status: "suggested",
    });
  });

  it("calls the injected adapter once with retained content and all resolved linked people", async () => {
    const extractCandidates = vi.fn(async (input: SuggestedMemoryExtractionInput) => ({
      candidates: input.resolvedPeople.map((person) => ({
        personId: person.id,
        content: `${person.displayName} has a candidate.`,
        memoryType: "context" as const,
      })),
    }));
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      extractCandidates,
    };
    const { processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: adapter,
    });
    const ada = await createPerson("Ada");
    const bo = await createPerson("Bo");
    const sourceRecord = await captureRecord({ retainedContent: "Dinner with Ada and Bo." });
    await link(sourceRecord.id, ada.id);
    await link(sourceRecord.id, bo.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(extractCandidates).toHaveBeenCalledTimes(1);
    expect(extractCandidates).toHaveBeenCalledWith({
      sourceRecord: expect.objectContaining({
        id: sourceRecord.id,
        content: "Dinner with Ada and Bo.",
      }),
      resolvedPeople: expect.arrayContaining([
        { id: ada.id, displayName: "Ada" },
        { id: bo.id, displayName: "Bo" },
      ]),
    });
    expect(result.suggestedMemories).toHaveLength(2);
    expect(result.suggestedMemories.map((memory) => memory.personId).sort()).toEqual(
      [ada.id, bo.id].sort(),
    );
  });

  it("completes zero-candidate extraction without creating suggestions", async () => {
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      async extractCandidates() {
        return { candidates: [] };
      },
    };
    const { store, processor, createPerson, captureRecord, link, auditActions, auditEntries } =
      createHarness({
        extractionAdapter: adapter,
      });
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({ retainedContent: "Small talk with Mark." });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories).toHaveLength(0);
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toEqual([]);
    await expect(auditActions()).resolves.toContain("extraction_job.completed");
    const completed = (await auditEntries()).find(
      (entry) => entry.action === "extraction_job.completed",
    );
    expect(completed?.metadataJson).toMatchObject({
      adapterKind: "fake",
      sourceRecordId: sourceRecord.id,
      extractionJobId: job.id,
      candidateCount: 0,
      invalidCandidateCount: 0,
      rejectedCandidateCount: 0,
      suggestedMemoryCount: 0,
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

  it("keeps unresolved-mention jobs partial while ignoring candidates for unresolved people", async () => {
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      async extractCandidates(input) {
        return {
          candidates: [
            {
              personId: input.resolvedPeople[0]?.id ?? "",
              content: "Nina is planning the dinner.",
              memoryType: "context",
            },
            {
              personId: "unresolved-jordan",
              content: "Jordan may attend dinner.",
              memoryType: "context",
            },
          ],
        };
      },
    };
    const { store, processor, capture, resolution, createPerson, auditActions } = createHarness({
      extractionAdapter: adapter,
    });
    const nina = await createPerson("Nina");
    const { sourceRecord } = await capture.captureSourceRecord({
      ownerUserId: OWNER,
      retainedContent: "Nina invited Jordan to dinner.",
      status: "active",
      unresolvedMentions: [{ mentionText: "Jordan", candidatePersonIds: [] }],
    });
    await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: OWNER,
      sourceRecordId: sourceRecord.id,
      personId: nina.id,
      role: "primary",
    });
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("partial");
    expect(result.job.status).toBe("pending");
    expect(result.suggestedMemories).toHaveLength(1);
    expect(result.suggestedMemories[0]?.personId).toBe(nina.id);
    const persisted = await store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.content).toBe("Nina is planning the dinner.");
    const actions = await auditActions();
    expect(actions).toContain("memory.suggest");
    expect(actions).toContain("extraction_job.partial");
  });

  it("rejects malformed adapter candidates without creating malformed suggestions", async () => {
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      async extractCandidates() {
        return {
          candidates: [
            { personId: "person-1", content: "", memoryType: "context" },
            { personId: "person-1", content: "Bad metadata.", memoryType: "unknown" },
            { personId: "person-1", content: "Bad importance.", importance: 6 },
            { personId: "person-1", content: "Bad confidence.", confidence: "certain" },
            { personId: "person-1", content: "Bad sensitivity.", sensitivity: "secret" },
          ],
        };
      },
    };
    const { store, processor, createPerson, captureRecord, link, auditEntries } = createHarness({
      extractionAdapter: adapter,
    });
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({ retainedContent: "Mark said something vague." });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories).toHaveLength(0);
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toEqual([]);
    const completed = (await auditEntries()).find(
      (entry) => entry.action === "extraction_job.completed",
    );
    expect(completed?.metadataJson).toMatchObject({
      adapterKind: "fake",
      candidateCount: 5,
      invalidCandidateCount: 5,
      rejectedCandidateCount: 5,
      suggestedMemoryCount: 0,
      sourceRecordId: sourceRecord.id,
      extractionJobId: job.id,
    });
  });

  it("marks adapter failures as retryable job failures without falling back", async () => {
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "llm",
      model: "test-model",
      async extractCandidates() {
        throw new Error("model unavailable");
      },
    };
    const { store, processor, createPerson, captureRecord, link, auditActions, auditEntries } =
      createHarness({
        extractionAdapter: adapter,
      });
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({ retainedContent: "Mark may be moving." });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("failed");
    expect(result.error).toBe("model unavailable");
    expect(result.job.status).toBe("failed");
    expect(result.job.runAfter.getTime()).toBeGreaterThan(Date.now());
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toEqual([]);
    await expect(auditActions()).resolves.toContain("extraction_job.failed");
    const failed = (await auditEntries()).find((entry) => entry.action === "extraction_job.failed");
    expect(failed?.metadataJson).toMatchObject({
      adapterKind: "llm",
      extractionModel: "test-model",
      sourceRecordId: sourceRecord.id,
      extractionJobId: job.id,
      failureReason: "adapter_error",
      failureMessage: "model unavailable",
    });
    expect(failed?.metadataJson).not.toHaveProperty("content");
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
  it("runs source-record policy gates before invoking the adapter", async () => {
    const extractCandidates = vi.fn(async () => ({ candidates: [] }));
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      extractCandidates,
    };
    const { store, processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: adapter,
    });
    const mark = await createPerson("Mark");

    const restricted = await captureRecord({
      retainedContent: "Restricted note.",
      sensitivity: "restricted",
    });
    await link(restricted.id, mark.id);
    const pending = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Pending note.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "pending_resolution",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await store.linkSourceRecordPerson({
      sourceRecordId: pending.id,
      personId: mark.id,
      role: "primary",
    });
    const dismissed = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Dismissed note.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "dismissed",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await store.linkSourceRecordPerson({
      sourceRecordId: dismissed.id,
      personId: mark.id,
      role: "primary",
    });
    const archived = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Archived note.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "archived",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await store.linkSourceRecordPerson({
      sourceRecordId: archived.id,
      personId: mark.id,
      role: "primary",
    });
    const personless = await captureRecord({ retainedContent: "Personless note." });

    for (const sourceRecord of [restricted, pending, dismissed, archived, personless]) {
      const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });
      await processor.processExtractionJob({ jobId: job.id });
    }

    expect(extractCandidates).not.toHaveBeenCalled();
  });

  it("delays unresolved personless records before invoking the adapter", async () => {
    const extractCandidates = vi.fn(async () => ({ candidates: [] }));
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      extractCandidates,
    };
    const { processor, capture } = createHarness({ extractionAdapter: adapter });
    const { sourceRecord } = await capture.captureSourceRecord({
      ownerUserId: OWNER,
      retainedContent: "Someone named Quinn might be worth tracking.",
      status: "active",
      unresolvedMentions: [{ mentionText: "Quinn", candidatePersonIds: [] }],
    });
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("delayed");
    expect(extractCandidates).not.toHaveBeenCalled();
  });

  it("allows directly requested restricted extraction to reach the adapter", async () => {
    const extractCandidates = vi.fn(async (input: SuggestedMemoryExtractionInput) => ({
      candidates: [
        {
          personId: input.resolvedPeople[0]?.id ?? "",
          content: "Mark has a restricted review candidate.",
          memoryType: "context" as const,
        },
      ],
    }));
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      extractCandidates,
    };
    const { processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: adapter,
    });
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({
      retainedContent: "Sensitive note for Mark.",
      sensitivity: "restricted",
    });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({
      jobId: job.id,
      directlyRequested: true,
    });

    expect(extractCandidates).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories[0]?.sensitivity).toBe("restricted");
  });

  it("does not let direct requests bypass inactive or personless hard gates", async () => {
    const extractCandidates = vi.fn(async () => ({ candidates: [] }));
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      extractCandidates,
    };
    const { store, processor, createPerson, captureRecord } = createHarness({
      extractionAdapter: adapter,
    });
    const mark = await createPerson("Mark");
    const archived = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Archived restricted note.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "archived",
      confidence: "medium",
      sensitivity: "restricted",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await store.linkSourceRecordPerson({
      sourceRecordId: archived.id,
      personId: mark.id,
      role: "primary",
    });
    const personless = await captureRecord({
      retainedContent: "Restricted but personless.",
      sensitivity: "restricted",
    });

    for (const sourceRecord of [archived, personless]) {
      const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });
      const result = await processor.processExtractionJob({
        jobId: job.id,
        directlyRequested: true,
      });

      expect(result.outcome).toBe("skipped");
    }
    expect(extractCandidates).not.toHaveBeenCalled();
  });

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

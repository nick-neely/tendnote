import type { SuggestedMemoryCandidate, SuggestedMemoryExtractionAdapter } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createHarness, OWNER } from "./harness";

function fixtureAdapter(candidates: SuggestedMemoryCandidate[]): SuggestedMemoryExtractionAdapter {
  return {
    kind: "fake",
    promptVersion: "fixture.v1",
    async extractCandidates() {
      return { candidates };
    },
  };
}

describe("Phase 1E.5 extraction-quality fixtures", () => {
  it("splits a messy relationship note into atomic tentative suggestions", async () => {
    const adapter: SuggestedMemoryExtractionAdapter = {
      kind: "fake",
      promptVersion: "fixture.v1",
      async extractCandidates(input) {
        const mara = input.resolvedPeople[0];

        return {
          candidates: mara
            ? [
                {
                  personId: mara.id,
                  content: "Mara is trying morning workouts again.",
                  memoryType: "context",
                },
                {
                  personId: mara.id,
                  content: "Mara is nervous about her October move.",
                  memoryType: "life_event",
                  importance: 4,
                },
              ]
            : [],
        };
      },
    };
    const harness = createHarness({ extractionAdapter: adapter });
    const localMara = await harness.createPerson("Mara");
    const localSource = await harness.captureRecord({
      retainedContent:
        "Dinner got rambly: Mara is trying morning workouts again and mentioned she is nervous about her October move.",
    });
    await harness.link(localSource.id, localMara.id);
    const { job } = await harness.processor.enqueueExtractionJob({
      sourceRecordId: localSource.id,
    });

    const result = await harness.processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories).toHaveLength(2);
    expect(result.suggestedMemories.map((memory) => memory.status)).toEqual([
      "suggested",
      "suggested",
    ]);
    await expect(
      harness.store.listApprovedMemoriesForPerson({ ownerUserId: OWNER, personId: localMara.id }),
    ).resolves.toEqual([]);
  });

  it("attaches multi-person candidates only to resolved people", async () => {
    const { store, processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: {
        kind: "fake",
        async extractCandidates(input) {
          return {
            candidates: [
              {
                personId:
                  input.resolvedPeople.find((person) => person.displayName === "Ada")?.id ?? "",
                content: "Ada is training for a 10K.",
                memoryType: "context",
              },
              {
                personId:
                  input.resolvedPeople.find((person) => person.displayName === "Bo")?.id ?? "",
                content: "Bo prefers quieter restaurants.",
                memoryType: "preference",
              },
              {
                personId: "unresolved-cam",
                content: "Cam might join next time.",
                memoryType: "context",
              },
            ],
          };
        },
      },
    });
    const ada = await createPerson("Ada");
    const bo = await createPerson("Bo");
    const sourceRecord = await captureRecord({
      retainedContent: "Group dinner with Ada, Bo, and maybe Cam.",
    });
    await link(sourceRecord.id, ada.id);
    await link(sourceRecord.id, bo.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.suggestedMemories.map((memory) => memory.personId).sort()).toEqual(
      [ada.id, bo.id].sort(),
    );
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toHaveLength(2);
  });

  it("keeps no-memory and do-not-infer notes at zero suggestions", async () => {
    let observedContent = "";
    const { store, processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: {
        kind: "fake",
        promptVersion: "fixture.v1",
        async extractCandidates(input) {
          observedContent = input.sourceRecord.content;

          return { candidates: [] };
        },
      },
    });
    const nina = await createPerson("Nina");
    const sourceRecord = await captureRecord({
      retainedContent:
        "Nina laughed at the cafe playlist; no durable preference or life update was stated.",
    });
    await link(sourceRecord.id, nina.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories).toEqual([]);
    expect(observedContent).toContain("no durable preference or life update was stated");
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toEqual([]);
  });

  it("does not persist over-specific invented claims in fixture output", async () => {
    const { store, processor, createPerson, captureRecord, link } = createHarness({
      extractionAdapter: {
        kind: "fake",
        promptVersion: "fixture.v1",
        async extractCandidates(input) {
          return {
            candidates: [
              {
                personId: input.resolvedPeople[0]?.id ?? "",
                content: "Priya said work has felt odd lately.",
                memoryType: "context",
              },
            ],
          };
        },
      },
    });
    const priya = await createPerson("Priya");
    const sourceRecord = await captureRecord({
      retainedContent: "Priya said work has been odd lately, but did not say she is changing jobs.",
    });
    await link(sourceRecord.id, priya.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    await processor.processExtractionJob({ jobId: job.id });

    const memories = await store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id });
    expect(memories).toHaveLength(1);
    expect(memories[0]?.content).toBe("Priya said work has felt odd lately.");
    expect(memories[0]?.content).not.toMatch(/new job|job change|changing jobs|quit/i);
  });

  it("keeps sensitive classification but gates restricted proactive extraction", async () => {
    const sensitiveHarness = createHarness({
      extractionAdapter: {
        kind: "fake",
        async extractCandidates(input) {
          return {
            candidates: [
              {
                personId: input.resolvedPeople[0]?.id ?? "",
                content: "Mark is dealing with a health concern.",
                memoryType: "context",
                sensitivity: "restricted",
              },
            ],
          };
        },
      },
    });
    const mark = await sensitiveHarness.createPerson("Mark");
    const sensitive = await sensitiveHarness.captureRecord({
      retainedContent: "Mark shared a health concern.",
      sensitivity: "sensitive",
    });
    await sensitiveHarness.link(sensitive.id, mark.id);
    const { job } = await sensitiveHarness.processor.enqueueExtractionJob({
      sourceRecordId: sensitive.id,
    });

    const result = await sensitiveHarness.processor.processExtractionJob({ jobId: job.id });

    expect(result.suggestedMemories[0]?.sensitivity).toBe("restricted");

    const restrictedHarness = createHarness({ extractionAdapter: fixtureAdapter([]) });
    const sara = await restrictedHarness.createPerson("Sara");
    const restricted = await restrictedHarness.captureRecord({
      retainedContent: "Sara shared something restricted.",
      sensitivity: "restricted",
    });
    await restrictedHarness.link(restricted.id, sara.id);
    const restrictedJob = await restrictedHarness.processor.enqueueExtractionJob({
      sourceRecordId: restricted.id,
    });

    const skipped = await restrictedHarness.processor.processExtractionJob({
      jobId: restrictedJob.job.id,
    });

    expect(skipped.outcome).toBe("skipped");
    await expect(
      restrictedHarness.store.listMemoriesForSourceRecord({ sourceRecordId: restricted.id }),
    ).resolves.toEqual([]);
  });

  it("does not bypass unresolved mention review", async () => {
    const { store, processor, capture } = createHarness({
      extractionAdapter: fixtureAdapter([
        {
          personId: "unresolved-jules",
          content: "Jules likes ramen.",
          memoryType: "preference",
        },
      ]),
    });
    const { sourceRecord } = await capture.captureSourceRecord({
      ownerUserId: OWNER,
      retainedContent: "Jules likes ramen, but Jules is not resolved yet.",
      status: "active",
      unresolvedMentions: [{ mentionText: "Jules", candidatePersonIds: [] }],
    });
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("delayed");
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toEqual([]);
  });
});

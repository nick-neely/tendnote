import { createFakeSuggestedActionExtractionAdapter } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import type { GeneralActionEmbeddingScheduler } from "../general-actions/types";
import { createHarness, OWNER } from "./harness";

type ScheduledEmbedding = { ownerUserId: string; recordKind: string; recordId: string };

describe("action extraction embed-on-write", () => {
  it("embeds each extraction-sourced suggested action on write", async () => {
    const scheduled: ScheduledEmbedding[] = [];
    const scheduleGeneralActionEmbedding: GeneralActionEmbeddingScheduler = async (input) => {
      scheduled.push(input);
    };
    const { processor, captureRecord } = createHarness({
      extractionAdapter: createFakeSuggestedActionExtractionAdapter([
        { title: "Replace the refrigerator water filter", reason: "It is overdue" },
      ]),
      scheduleGeneralActionEmbedding,
    });
    const source = await captureRecord();

    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });
    const result = await processor.processActionExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedActionIds).toHaveLength(1);
    // The extraction-produced suggestion is embedded on write, just like a suggestion
    // created through the general-actions barrel — so it is semantically retrievable in
    // owner-only review context before acceptance (ADR 0150; Phase 5 #183/#184).
    expect(scheduled).toEqual([
      {
        ownerUserId: OWNER,
        recordKind: "general_action",
        recordId: result.suggestedActionIds[0],
      },
    ]);
  });

  it("does not require a scheduler (extraction still completes with a no-op default)", async () => {
    const { processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: createFakeSuggestedActionExtractionAdapter([{ title: "Do a thing" }]),
    });
    const source = await captureRecord();

    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });
    const result = await processor.processActionExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    await expect(listActionsForSource(source.id)).resolves.toHaveLength(1);
  });
});

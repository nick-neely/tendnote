import { createFakeSuggestedActionExtractionAdapter } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createHarness } from "./harness";

describe("extracted proposal scope defaults", () => {
  it("defaults a proposal to private", async () => {
    const { processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: createFakeSuggestedActionExtractionAdapter([{ title: "Do a thing" }]),
    });
    const source = await captureRecord({ scope: "private" });
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });
    await processor.processActionExtractionJob({ jobId: job.id });

    const [action] = await listActionsForSource(source.id);
    expect(action?.scope).toBe("private");
  });

  it("does not widen scope from guild/channel capture context", async () => {
    // A private capture that happens to carry guild/channel metadata, with a model that
    // asks for household — the proposal must still be private (ADR 0140, #169).
    const { processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: createFakeSuggestedActionExtractionAdapter([
        { title: "Do a thing", scope: "household" },
      ]),
    });
    const source = await captureRecord({
      scope: "private",
      metadataJson: { discordGuildId: "guild-1", discordChannelId: "channel-1" },
    });
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });
    await processor.processActionExtractionJob({ jobId: job.id });

    const [action] = await listActionsForSource(source.id);
    expect(action?.scope).toBe("private");
    expect(action?.householdId).toBeNull();
  });
});

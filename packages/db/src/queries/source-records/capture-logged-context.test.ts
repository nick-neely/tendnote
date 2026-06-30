import type { SourceRecord } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { type CaptureLoggedContextDeps, captureLoggedContext } from "./capture-logged-context";
import type { CaptureSourceRecordResult } from "./types";

const OWNER = "owner-1";

function captureResult(id: string): CaptureSourceRecordResult {
  return {
    sourceRecord: { id, ownerUserId: OWNER, content: "logged" } as unknown as SourceRecord,
    component: { type: "source_record_review", sourceRecordId: id },
  };
}

function deps(overrides: Partial<CaptureLoggedContextDeps> = {}): CaptureLoggedContextDeps {
  return {
    captureForPerson: vi.fn(async () => captureResult("sr-person")),
    captureGlobal: vi.fn(async () => captureResult("sr-global")),
    enqueueExtraction: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("captureLoggedContext", () => {
  it("captures + links a known person, then enqueues extraction for that record", async () => {
    const d = deps();

    const result = await captureLoggedContext(
      {
        ownerUserId: OWNER,
        retainedContent: "Lunch with Mara",
        personId: "p1",
        captureSurface: "eve",
      },
      d,
    );

    expect(d.captureForPerson).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      personId: "p1",
      retainedContent: "Lunch with Mara",
      sensitivity: undefined,
      metadataJson: { captureSurface: "eve" },
    });
    expect(d.captureGlobal).not.toHaveBeenCalled();
    expect(d.enqueueExtraction).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      sourceRecordId: "sr-person",
    });
    expect(result.sourceRecord.id).toBe("sr-person");
  });

  it("captures a global Source Record when no person is given", async () => {
    const d = deps();

    const result = await captureLoggedContext(
      {
        ownerUserId: OWNER,
        retainedContent: "Saw a great talk",
        captureSurface: "global_assistant",
      },
      d,
    );

    expect(d.captureGlobal).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      retainedContent: "Saw a great talk",
      sensitivity: undefined,
      metadataJson: { captureSurface: "global_assistant" },
    });
    expect(d.captureForPerson).not.toHaveBeenCalled();
    expect(d.enqueueExtraction).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      sourceRecordId: "sr-global",
    });
    expect(result.sourceRecord.id).toBe("sr-global");
  });

  it("threads sensitivity through the capture", async () => {
    const d = deps();

    await captureLoggedContext(
      {
        ownerUserId: OWNER,
        retainedContent: "Delicate",
        personId: "p1",
        sensitivity: "sensitive",
        captureSurface: "eve",
      },
      d,
    );

    expect(d.captureForPerson).toHaveBeenCalledWith(
      expect.objectContaining({ sensitivity: "sensitive" }),
    );
  });

  it("still returns the captured record when extraction enqueue fails (best-effort)", async () => {
    const d = deps({
      enqueueExtraction: vi.fn(async () => {
        throw new Error("queue down");
      }),
    });

    const result = await captureLoggedContext(
      { ownerUserId: OWNER, retainedContent: "note", personId: "p1", captureSurface: "eve" },
      d,
    );

    expect(result.sourceRecord.id).toBe("sr-person");
    expect(d.enqueueExtraction).toHaveBeenCalledTimes(1);
  });
});

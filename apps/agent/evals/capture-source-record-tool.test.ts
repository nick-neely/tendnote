import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureSourceRecord, captureSourceRecordForPerson, enqueueExtractionJob } = vi.hoisted(
  () => ({
    captureSourceRecord: vi.fn(),
    captureSourceRecordForPerson: vi.fn(),
    enqueueExtractionJob: vi.fn(),
  }),
);

vi.mock("@tendnote/db", () => ({
  captureSourceRecord,
  captureSourceRecordForPerson,
  enqueueExtractionJob,
}));

const { default: tool } = await import("../agent/tools/capture_source_record");

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

function sourceRecordResult(id: string) {
  return {
    sourceRecord: { id, status: "active", content: "Had lunch with Mark." },
    component: { type: "source_record_review", sourceRecordId: id },
  };
}

describe("capture_source_record tool (casual note → logged context)", () => {
  it("logs a casual note as a source record without linking a person when identity is unknown", async () => {
    captureSourceRecord.mockResolvedValue(sourceRecordResult("source-1"));
    enqueueExtractionJob.mockResolvedValue(undefined);

    const result = await tool.execute({ retainedContent: "Had lunch with Mark." }, ctx);

    expect(captureSourceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-1", retainedContent: "Had lunch with Mark." }),
    );
    expect(captureSourceRecordForPerson).not.toHaveBeenCalled();
    expect(result.sourceRecord.id).toBe("source-1");
    expect(result.linkedPersonId).toBeNull();
    // It is logged context, not a confirmed fact — the persisted record carries a
    // review component for the web UI.
    expect(result.component).toEqual({ type: "source_record_review", sourceRecordId: "source-1" });
  });

  it("links the note to a resolved person when identity is unambiguous", async () => {
    captureSourceRecordForPerson.mockResolvedValue(sourceRecordResult("source-2"));
    enqueueExtractionJob.mockResolvedValue(undefined);

    const result = await tool.execute(
      {
        retainedContent: "Mark might be switching jobs.",
        personId: "11111111-1111-1111-1111-111111111111",
      },
      ctx,
    );

    expect(captureSourceRecordForPerson).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        personId: "11111111-1111-1111-1111-111111111111",
      }),
    );
    expect(captureSourceRecord).not.toHaveBeenCalled();
    expect(result.linkedPersonId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("still returns the saved record when extraction enqueue fails", async () => {
    captureSourceRecord.mockResolvedValue(sourceRecordResult("source-3"));
    enqueueExtractionJob.mockRejectedValue(new Error("queue down"));

    const result = await tool.execute({ retainedContent: "Quick note." }, ctx);

    expect(result.sourceRecord.id).toBe("source-3");
  });
});

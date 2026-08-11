import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const {
  captureSourceRecord,
  captureSourceRecordForPersonWithEmbeddingDelivery,
  enqueueAndPublishExtractionJob,
  enqueueAndPublishActionExtractionJob,
} = vi.hoisted(() => ({
  captureSourceRecord: vi.fn(),
  captureSourceRecordForPersonWithEmbeddingDelivery: vi.fn(),
  enqueueAndPublishExtractionJob: vi.fn(),
  enqueueAndPublishActionExtractionJob: vi.fn(),
}));

// Keep the real captureLoggedContext orchestration (candidate 5) so the assertions
// below still verify the tool drives capture + extraction through the injected deps;
// only the leaf capture/enqueue functions are mocked.
vi.mock("@tendnote/db/queries/source-records", async (importActual) => {
  const actual = await importActual<typeof import("@tendnote/db/queries/source-records")>();
  return {
    captureSourceRecord,
    captureLoggedContext: actual.captureLoggedContext,
  };
});
vi.mock("../agent/lib/background-jobs/embedding-schedulers", () => ({
  captureSourceRecordForPersonWithEmbeddingDelivery,
}));
vi.mock("../agent/lib/background-jobs/extraction-queue", () => ({
  enqueueAndPublishExtractionJob,
  enqueueAndPublishActionExtractionJob,
}));

const { default: rawTool } = await import("../agent/tools/capture_source_record");
const tool = asTestTool(rawTool);

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
    enqueueAndPublishExtractionJob.mockResolvedValue(undefined);

    const result = await tool.execute({ retainedContent: "Had lunch with Mark." }, ctx);

    expect(captureSourceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-1", retainedContent: "Had lunch with Mark." }),
    );
    expect(captureSourceRecordForPersonWithEmbeddingDelivery).not.toHaveBeenCalled();
    expect(enqueueAndPublishExtractionJob).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      sourceRecordId: "source-1",
    });
    // Action extraction is enqueued for the same record, alongside memory extraction.
    expect(enqueueAndPublishActionExtractionJob).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      sourceRecordId: "source-1",
    });
    expect(result.sourceRecord.id).toBe("source-1");
    expect(result.linkedPersonId).toBeNull();
    // It is logged context, not a confirmed fact — the persisted record carries a
    // review component for the web UI.
    expect(result.component).toEqual({ type: "source_record_review", sourceRecordId: "source-1" });
  });

  it("links the note to a resolved person when identity is unambiguous", async () => {
    captureSourceRecordForPersonWithEmbeddingDelivery.mockResolvedValue(
      sourceRecordResult("source-2"),
    );
    enqueueAndPublishExtractionJob.mockResolvedValue(undefined);

    const result = await tool.execute(
      {
        retainedContent: "Mark might be switching jobs.",
        personId: "11111111-1111-1111-1111-111111111111",
      },
      ctx,
    );

    expect(captureSourceRecordForPersonWithEmbeddingDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        personId: "11111111-1111-1111-1111-111111111111",
      }),
    );
    expect(captureSourceRecord).not.toHaveBeenCalled();
    expect(enqueueAndPublishExtractionJob).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      sourceRecordId: "source-2",
    });
    expect(result.linkedPersonId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("still returns the saved record when extraction trigger fails", async () => {
    captureSourceRecord.mockResolvedValue(sourceRecordResult("source-3"));
    enqueueAndPublishExtractionJob.mockRejectedValue(new Error("queue down"));

    const result = await tool.execute({ retainedContent: "Quick note." }, ctx);

    expect(result.sourceRecord.id).toBe("source-3");
  });
});

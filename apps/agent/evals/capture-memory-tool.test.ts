import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureExplicitMemory } = vi.hoisted(() => ({ captureExplicitMemory: vi.fn() }));

vi.mock("@tendnote/db", () => ({ captureExplicitMemory }));

const { default: tool } = await import("../agent/tools/capture_memory");

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

function captureResult() {
  return {
    memory: {
      id: "memory-1",
      personId: "person-1",
      content: "Caleb is moving to Denver in August.",
      status: "approved",
      sensitivity: "normal",
      confidence: "medium",
      sourceRecordId: "source-1",
    },
    sourceRecord: { id: "source-1", status: "active" },
    person: { id: "person-1", displayName: "Caleb" },
  };
}

describe("capture_memory tool (explicit remember/save → approved memory)", () => {
  it("saves an approved memory through the shared owner-scoped capture path", async () => {
    captureExplicitMemory.mockResolvedValue(captureResult());

    const result = await tool.execute(
      { personId: "person-1", request: "Remember Caleb is moving to Denver in August." },
      ctx,
    );

    expect(captureExplicitMemory).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-1", personId: "person-1" }),
    );
    expect(result.memory.id).toBe("memory-1");
    expect(result.memory.status).toBe("approved");
  });

  it("preserves source-record provenance: the memory points back to its source record", async () => {
    captureExplicitMemory.mockResolvedValue(captureResult());

    const result = await tool.execute(
      { personId: "person-1", request: "Remember Caleb is moving to Denver in August." },
      ctx,
    );

    expect(result.sourceRecord.id).toBe("source-1");
    expect(result.memory.sourceRecordId).toBe("source-1");
  });

  it("returns a persisted record reference the web UI can render", async () => {
    captureExplicitMemory.mockResolvedValue(captureResult());

    const result = await tool.execute(
      { personId: "person-1", request: "Remember Caleb is moving to Denver in August." },
      ctx,
    );

    expect(result.component).toEqual({
      type: "memory_saved",
      memoryId: "memory-1",
      sourceRecordId: "source-1",
      personId: "person-1",
    });
  });
});

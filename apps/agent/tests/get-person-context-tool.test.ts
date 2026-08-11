import { describe, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const { getPersonContextSnapshot } = vi.hoisted(() => ({
  getPersonContextSnapshot: vi.fn(),
}));

vi.mock("@tendnote/db/queries/context-snapshots", () => ({ getPersonContextSnapshot }));

const { default: rawTool } = await import("../agent/tools/get_person_context");
const tool = asTestTool(rawTool);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

const person = {
  id: "person-1",
  displayName: "Mark",
  relationshipType: "friend",
  birthday: null,
  profileBlurb: null,
};

function snapshot() {
  return {
    summary: "Mark is a friend relationship.\nConfirmed: Mark is vegetarian.",
    generatedAt: new Date("2026-06-20T00:00:00Z"),
    supportingReferences: {
      personIds: ["person-1"],
      memoryIds: ["memory-1"],
      sourceRecordIds: ["source-1"],
      suggestedMemoryIds: ["suggested-1"],
      followupIds: ["followup-1"],
    },
    followups: [
      { id: "followup-1", status: "open", dueAt: "2026-07-01T00:00:00.000Z", reason: "Check in." },
    ],
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    person,
    approvedMemories: [
      {
        id: "memory-1",
        content: "Mark is vegetarian.",
        sensitivity: "normal",
        confidence: "medium",
      },
    ],
    sourceRecords: [
      {
        id: "source-1",
        content: "Had lunch with Mark.",
        sourceType: "manual",
        sensitivity: "normal",
        createdAt: new Date("2026-06-10T00:00:00Z"),
      },
    ],
    suggestedMemories: [{ id: "suggested-1", content: "Maybe moving.", sensitivity: "normal" }],
    ...overrides,
  };
}

describe("get_person_context tool (runtime)", () => {
  it("returns the snapshot summary plus grounding records with ids on a fresh read", async () => {
    getPersonContextSnapshot.mockResolvedValue({
      status: "fresh",
      snapshot: snapshot(),
      context: context(),
    });

    const result = await tool.execute({ personId: "person-1" }, ctx);

    if (!result.found) throw new Error("expected the person to be found");
    expect(result.snapshot?.summary).toContain("Mark is vegetarian.");
    expect(result.snapshotStatus).toBe("fresh");
    // Source-reference availability: grounding records carry ids Eve can fetch.
    expect(result.approvedMemories[0]?.id).toBe("memory-1");
    expect(result.sourceRecords[0]?.id).toBe("source-1");
    expect(result.suggestedMemories[0]?.id).toBe("suggested-1");
    // Compact follow-up context rides along on the snapshot.
    expect(result.snapshot?.followups[0]?.reason).toBe("Check in.");
  });

  it("fails open: nulls the snapshot but still returns grounding records on fallback", async () => {
    getPersonContextSnapshot.mockResolvedValue({
      status: "fallback",
      snapshot: snapshot(), // a stale snapshot may exist, but must not be served
      context: context(),
    });

    const result = await tool.execute({ personId: "person-1" }, ctx);

    if (!result.found) throw new Error("expected the person to be found");
    expect(result.snapshot).toBeNull();
    expect(result.snapshotStatus).toBe("fallback");
    expect(result.approvedMemories[0]?.id).toBe("memory-1");
  });

  it("defaults to hiding restricted context and forwards a direct request live", async () => {
    getPersonContextSnapshot.mockResolvedValue({
      status: "fresh",
      snapshot: snapshot(),
      context: context(),
    });

    await tool.execute({ personId: "person-1" }, ctx);
    expect(getPersonContextSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ directlyRequested: false }),
    );

    await tool.execute({ personId: "person-1", includeRestricted: true }, ctx);
    expect(getPersonContextSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ directlyRequested: true }),
    );
  });

  it("reports not found for an unknown person", async () => {
    getPersonContextSnapshot.mockResolvedValue({
      status: "fallback",
      snapshot: null,
      context: context({ person: null }),
    });

    const result = await tool.execute({ personId: "missing" }, ctx);

    expect(result.found).toBe(false);
  });

  it("returns a refresh-stable person-context reference the web chat can render", async () => {
    getPersonContextSnapshot.mockResolvedValue({
      status: "fresh",
      snapshot: snapshot(),
      context: context(),
    });

    const result = await tool.execute({ personId: "person-1" }, ctx);

    if (!result.found) throw new Error("expected the person to be found");
    // Reference for #25 to render the loaded context: the persisted person id
    // plus the fail-open snapshot status (ADR 0028); a refresh reloads records.
    expect(result.component).toEqual({
      type: "person_context",
      personId: "person-1",
      snapshotStatus: "fresh",
    });
  });

  it("carries the fail-open snapshot status on the reference instead of dropping it", async () => {
    getPersonContextSnapshot.mockResolvedValue({
      status: "fallback",
      snapshot: snapshot(),
      context: context(),
    });

    const result = await tool.execute({ personId: "person-1" }, ctx);

    if (!result.found) throw new Error("expected the person to be found");
    expect(result.component).toEqual({
      type: "person_context",
      personId: "person-1",
      snapshotStatus: "fallback",
    });
  });

  it("no-fake-memory: never promotes logged context or suggestions into the confirmed-facts tier", async () => {
    getPersonContextSnapshot.mockResolvedValue({
      status: "fresh",
      snapshot: snapshot(),
      context: context(),
    });

    const result = await tool.execute({ personId: "person-1" }, ctx);

    if (!result.found) throw new Error("expected the person to be found");
    const approvedIds = result.approvedMemories.map((memory) => memory.id);
    // The tentative suggestion and the logged source record must stay in their
    // own tiers and never appear among confirmed facts.
    expect(approvedIds).toEqual(["memory-1"]);
    expect(approvedIds).not.toContain("suggested-1");
    expect(approvedIds).not.toContain("source-1");
    expect(result.suggestedMemories.map((memory) => memory.id)).toEqual(["suggested-1"]);
    expect(result.sourceRecords.map((record) => record.id)).toEqual(["source-1"]);
  });
});

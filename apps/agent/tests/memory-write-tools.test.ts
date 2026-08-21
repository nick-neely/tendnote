import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, parseToolInput, toolModelValue } from "./test-tool";

const { captureSuggestedMemoryFromSource, archiveMemory } = vi.hoisted(() => ({
  captureSuggestedMemoryFromSource: vi.fn(),
  archiveMemory: vi.fn(),
}));
vi.mock("@tendnote/db/queries/memories", () => ({
  captureSuggestedMemoryFromSource,
  archiveMemory,
}));

const { requestBackgroundAffectedScopeReconciliation } = vi.hoisted(() => ({
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation,
}));

const { default: rawProposeTool } = await import("../agent/tools/propose_suggested_memory");
const { default: rawArchiveTool } = await import("../agent/tools/archive_memory");
const proposeTool = asTestTool(rawProposeTool);
const archiveTool = asTestTool(rawArchiveTool);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;
const MEMORY_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const SCOPES = [{ kind: "viewer-collection", collection: "memories", viewerUserId: "user-1" }];

beforeEach(() => vi.clearAllMocks());

describe("propose_suggested_memory", () => {
  function proposed() {
    return {
      result: {
        memory: {
          id: MEMORY_ID,
          personId: PERSON_ID,
          content: "SECRET_SUGGESTION",
          status: "suggested",
          sensitivity: "normal",
          sourceRecordId: SOURCE_ID,
        },
        person: { id: PERSON_ID, displayName: "Priya Shah" },
        sourceRecord: { id: SOURCE_ID },
      },
      affectedScopes: SCOPES,
    };
  }

  it("writes through the suggested seam for the session's owner, grounded in the given record", async () => {
    captureSuggestedMemoryFromSource.mockResolvedValue(proposed());

    await proposeTool.execute(
      { personId: PERSON_ID, content: "Her sister moves in August", sourceRecordId: SOURCE_ID },
      ctx,
    );

    // The only seam this tool can reach writes `suggested`. There is no argument shape
    // here that produces an approved memory, which is what makes "propose, do not save"
    // structural rather than a promise in the description.
    expect(captureSuggestedMemoryFromSource).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      personId: PERSON_ID,
      sourceRecordId: SOURCE_ID,
      content: "Her sister moves in August",
    });
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith(SCOPES);
  });

  it("renders the review card and keeps the proposed fact out of the model's view", async () => {
    captureSuggestedMemoryFromSource.mockResolvedValue(proposed());

    const output = await proposeTool.execute(
      { personId: PERSON_ID, content: "Her sister moves in August", sourceRecordId: SOURCE_ID },
      ctx,
    );
    const value = toolModelValue(proposeTool, output);

    // The card carries the text and the accept/dismiss controls; the model gets the
    // handles, the person's name, and an unambiguous "nothing was saved".
    expect(output.component).toEqual({
      type: "suggested_memory_review",
      memoryId: MEMORY_ID,
      sourceRecordId: SOURCE_ID,
    });
    expect(output.memory.status).toBe("suggested");
    expect(output.memory.sourceRecordId).toBe(SOURCE_ID);
    expect(output.sourceRecord.id).toBe(SOURCE_ID);
    expect(value.saved).toBe(false);
    expect(value.person).toBe("Priya Shah");
    expect(JSON.stringify(value)).not.toContain("SECRET_SUGGESTION");
    expect(JSON.stringify(value)).not.toContain(PERSON_ID);
  });

  it("curates a store failure instead of handing the model raw SQL", async () => {
    captureSuggestedMemoryFromSource.mockRejectedValue(
      new Error('Failed query: insert into "memories" ...'),
    );

    await expect(
      proposeTool.execute(
        { personId: PERSON_ID, content: "Her sister moves in August", sourceRecordId: SOURCE_ID },
        ctx,
      ),
    ).rejects.toThrow(/Could not read the user's records right now/);
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });

  it("requires grounding, so a proposal can never be ungrounded", () => {
    // ADR 0022: a Source Record behind every memory write. The tool takes an existing
    // id rather than capturing one, so a failed proposal leaves no orphaned note.
    expect(() =>
      parseToolInput(proposeTool, {
        personId: PERSON_ID,
        content: "x",
        sourceRecordId: SOURCE_ID,
      }),
    ).not.toThrow();
    expect(() => parseToolInput(proposeTool, { personId: PERSON_ID, content: "x" })).toThrow();
  });
});

describe("archive_memory", () => {
  it("archives the named memory for the session's owner and reconciles the scopes", async () => {
    archiveMemory.mockResolvedValue({
      result: { id: MEMORY_ID, personId: PERSON_ID, status: "archived" },
      affectedScopes: SCOPES,
    });

    await archiveTool.execute({ memoryId: MEMORY_ID }, ctx);

    expect(archiveMemory).toHaveBeenCalledWith({ ownerUserId: "user-1", memoryId: MEMORY_ID });
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith(SCOPES);
  });

  it("reports the memory's state, not a claim about what this call did", async () => {
    // The seam is idempotent: archiving something already archived returns it unchanged.
    // Reporting `archived: true` either way would be the false-success pattern the
    // capture tools were fixed for, so the persisted status is what travels.
    archiveMemory.mockResolvedValue({
      result: { id: MEMORY_ID, personId: PERSON_ID, status: "archived" },
      affectedScopes: [],
    });

    const output = await archiveTool.execute({ memoryId: MEMORY_ID }, ctx);
    const value = toolModelValue(archiveTool, output);

    expect(output.status).toBe("archived");
    expect(value.status).toBe("archived");
    // Neither the content nor any id reaches the model: it has just been told to stop
    // using this fact.
    expect(JSON.stringify(value)).not.toContain(MEMORY_ID);
    expect(JSON.stringify(value)).not.toContain(PERSON_ID);
  });

  it("takes a memory id and nothing that could resolve one loosely", () => {
    expect(() => parseToolInput(archiveTool, { memoryId: MEMORY_ID })).not.toThrow();
    // No person-wide sweep, no free-text match: an ambiguous archive loses a fact the
    // user still wanted and nobody notices for months.
    expect(() => parseToolInput(archiveTool, { personId: PERSON_ID })).toThrow();
    expect(() => parseToolInput(archiveTool, { memoryId: "the one about the move" })).toThrow();
  });

  it("curates a store failure instead of handing the model raw SQL", async () => {
    archiveMemory.mockRejectedValue(new Error('Failed query: update "memories" ...'));

    await expect(archiveTool.execute({ memoryId: MEMORY_ID }, ctx)).rejects.toThrow(
      /Could not read the user's records right now/,
    );
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, parseToolInput, toolModelValue } from "./test-tool";

/**
 * The root agent could write a draft and then never see it again.
 *
 * `create_message_draft` hands back a draft id for one turn; after that the only
 * read was the `relationship_strategist` copy, which requires a personId that
 * subagent has no way to obtain (G1). So "what did I write to Sam?" and "save that
 * approved draft to Gmail" were both unanswerable a turn later. These pin the root
 * read, and pin that reading a draft stays a read: no send, no export, no claim that
 * anything left Tendnote.
 */
const mocks = vi.hoisted(() => ({
  listDraftsForOwner: vi.fn(),
  listDraftsForPerson: vi.fn(),
  getPerson: vi.fn(),
}));

vi.mock("@tendnote/db/queries/drafts", () => ({
  listDraftsForOwner: mocks.listDraftsForOwner,
  listDraftsForPerson: mocks.listDraftsForPerson,
}));
vi.mock("@tendnote/db/queries/people", () => ({ getPerson: mocks.getPerson }));

const { default: rawTool } = await import("../agent/tools/list_message_drafts");
const tool = asTestTool(rawTool);

const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    personId: PERSON_ID,
    ownerUserId: "owner-1",
    channel: "text",
    purpose: "check_in",
    status: "approved",
    body: "Thinking of you before the move.",
    sourceRefs: [
      { kind: "approved_memory", id: SOURCE_ID, label: "Moving in March", trust: "confirmed_fact" },
    ],
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-02T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listDraftsForOwner.mockResolvedValue([draft()]);
  mocks.listDraftsForPerson.mockResolvedValue([draft()]);
  mocks.getPerson.mockResolvedValue({ id: PERSON_ID, displayName: "Sam Ortiz" });
});

describe("list_message_drafts", () => {
  it("reads across everyone with the session owner's id when no person is named", async () => {
    await tool.execute(parseToolInput(tool, {}), ctx);

    expect(mocks.listDraftsForOwner).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      statuses: undefined,
    });
    expect(mocks.listDraftsForPerson).not.toHaveBeenCalled();
  });

  it("narrows to one resolved person, and to the statuses asked for", async () => {
    await tool.execute(
      parseToolInput(tool, { personId: PERSON_ID, statuses: ["draft", "approved"] }),
      ctx,
    );

    expect(mocks.listDraftsForPerson).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      personId: PERSON_ID,
      statuses: ["draft", "approved"],
    });
    expect(mocks.listDraftsForOwner).not.toHaveBeenCalled();
  });

  it("bounds the page by default, reports the cut, and refuses a limit past the cap", async () => {
    mocks.listDraftsForOwner.mockResolvedValue([
      draft({ id: "a" }),
      draft({ id: "b" }),
      draft({ id: "c" }),
    ]);

    const output = await tool.execute(parseToolInput(tool, { limit: 2 }), ctx);

    expect(output.count).toBe(2);
    expect(output.truncated).toBe(true);
    // The whole body of every draft travels, so the default page is deliberately small.
    expect(parseToolInput(tool, {}).limit).toBe(5);
    expect(() => parseToolInput(tool, { limit: 500 })).toThrow();
  });

  it("resolves each person once, on the page the model actually sees", async () => {
    mocks.listDraftsForOwner.mockResolvedValue([draft({ id: "a" }), draft({ id: "b" })]);

    const output = await tool.execute(parseToolInput(tool, {}), ctx);
    const model = toolModelValue(tool, output) as { drafts: Array<{ forWhom: string }> };

    // Two drafts for one person is one lookup, and the model gets the name, not the id.
    expect(mocks.getPerson).toHaveBeenCalledTimes(1);
    expect(mocks.getPerson).toHaveBeenCalledWith({ ownerUserId: "owner-1", personId: PERSON_ID });
    expect(model.drafts.map((entry) => entry.forWhom)).toEqual(["Sam Ortiz", "Sam Ortiz"]);
  });

  it("gives the model the draft handle and the body, but no person or grounding ids", async () => {
    const output = await tool.execute(parseToolInput(tool, {}), ctx);
    const model = toolModelValue(tool, output);
    const serialized = JSON.stringify(model);

    // `save_draft_to_gmail` takes a draftId and there is no other way to obtain one for
    // a draft written in an earlier turn; a guessed id is a failed call.
    expect(serialized).toContain(DRAFT_ID);
    expect(serialized).toContain("Thinking of you before the move.");
    expect(serialized).toContain("Moving in March");
    expect(serialized).not.toContain(PERSON_ID);
    expect(serialized).not.toContain(SOURCE_ID);
  });

  it("frames approval as internal and externalizing as still gated", async () => {
    const output = await tool.execute(parseToolInput(tool, {}), ctx);
    const model = toolModelValue(tool, output) as { guidance: string };

    expect(model.guidance).toMatch(/none of them has been sent or exported/i);
    expect(model.guidance).toMatch(/confirms the recipient and subject/i);
  });

  it("says plainly when there are none, rather than describing a draft it did not get", async () => {
    mocks.listDraftsForOwner.mockResolvedValue([]);

    const output = await tool.execute(parseToolInput(tool, {}), ctx);
    const model = toolModelValue(tool, output) as { drafts: unknown[]; guidance: string };

    expect(model.drafts).toEqual([]);
    expect(model.guidance).toMatch(/never claim one was sent/i);
    expect(mocks.getPerson).not.toHaveBeenCalled();
  });

  it("curates a store failure instead of handing the model the query", async () => {
    mocks.listDraftsForOwner.mockRejectedValue(
      new Error('Failed query: select * from "message_drafts" params: owner-1'),
    );

    await expect(tool.execute(parseToolInput(tool, {}), ctx)).rejects.toThrow(
      /Could not read the user's records right now/,
    );
  });
});

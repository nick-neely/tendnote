import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, parseToolInput, toolModelValue } from "./test-tool";

/**
 * Saved Items were writable and barely readable.
 *
 * Capture has been able to create one since Phase 7, but the only way back to the
 * pile was a global recall search over words the user had to already remember. This
 * pins the browse that answers "what did I save?" — and pins that it is the same
 * caller-keyed read the web surface makes, so a household-native item appears here
 * on exactly the terms it appears in the app and this tool adds no authorization of
 * its own (ADR 0214, ADR 0219).
 */
const mocks = vi.hoisted(() => ({ listSavedItems: vi.fn() }));

vi.mock("@tendnote/db/queries/saved-items", () => ({ listSavedItems: mocks.listSavedItems }));

const { default: rawTool } = await import("../agent/tools/list_saved_items");
const tool = asTestTool(rawTool);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function savedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "user-1",
    ownership: "member_owned",
    kind: "note",
    title: "Roof quote",
    content: "The roofer said mid-March.",
    url: null,
    status: "active",
    scope: "private",
    householdId: null,
    bringBackAt: null,
    bringBackTimeSemantics: "date_only",
    resolvedAt: null,
    resolutionReason: null,
    sourceRecordId: "22222222-2222-4222-8222-222222222222",
    createdByUserId: "user-1",
    lastActorUserId: "user-1",
    version: 1,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-02T00:00:00.000Z"),
    sharedWithUserIds: [],
    householdName: null,
    outcomes: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSavedItems.mockResolvedValue([savedItem()]);
});

describe("list_saved_items", () => {
  it("asks the shared read with the session's own caller id and nothing else", async () => {
    await tool.execute(parseToolInput(tool, {}), ctx);

    // No owner, no household, no audience argument: there is no input shape the model
    // could produce that widens what comes back.
    expect(mocks.listSavedItems).toHaveBeenCalledWith({
      callerUserId: "user-1",
      includeArchived: false,
      limit: 15,
    });
  });

  it("pushes the caller's limit down when the store's own filter is enough", async () => {
    await tool.execute(parseToolInput(tool, { status: "all", limit: 3 }), ctx);

    expect(mocks.listSavedItems).toHaveBeenCalledWith({
      callerUserId: "user-1",
      includeArchived: true,
      limit: 3,
    });
    expect(() => parseToolInput(tool, { limit: 500 })).toThrow();
  });

  it("filters archived and resolved here, and bounds the result after filtering", async () => {
    // A store limit would starve these: the read is ordered by recency across both
    // states, so the newest active items would fill the page before the filter ran.
    mocks.listSavedItems.mockResolvedValue([
      savedItem({ id: "a", status: "active" }),
      savedItem({
        id: "b",
        status: "archived",
        resolvedAt: new Date(),
        resolutionReason: "Booked",
      }),
      savedItem({ id: "c", status: "archived" }),
    ]);

    const resolved = await tool.execute(parseToolInput(tool, { status: "resolved" }), ctx);
    expect(mocks.listSavedItems).toHaveBeenCalledWith({
      callerUserId: "user-1",
      includeArchived: true,
      limit: undefined,
    });
    expect(resolved.count).toBe(1);
    expect(resolved.savedItems[0]?.resolutionReason).toBe("Booked");

    const archived = await tool.execute(
      parseToolInput(tool, { status: "archived", limit: 1 }),
      ctx,
    );
    expect(archived.count).toBe(1);
    expect(archived.truncated).toBe(true);
  });

  it("says an excerpt is an excerpt rather than passing a clipped note off as the note", async () => {
    mocks.listSavedItems.mockResolvedValue([savedItem({ content: "x".repeat(400) })]);

    const output = await tool.execute(parseToolInput(tool, {}), ctx);
    const model = toolModelValue(tool, output) as {
      savedItems: Array<{ excerpt: string; excerptTruncated: boolean }>;
      guidance: string;
    };

    expect(model.savedItems[0]?.excerptTruncated).toBe(true);
    expect(model.savedItems[0]?.excerpt).toMatch(/…$/);
    expect(model.guidance).toMatch(/never as the complete note/i);
  });

  it("offers no visibility label for a record the household simply owns", async () => {
    // A household-native item has no audience anyone chose, so no label is stated for
    // one; the ownership form is offered instead (ADR 0214).
    mocks.listSavedItems.mockResolvedValue([
      savedItem({ ownership: "household_native", ownerUserId: null, scope: "household" }),
    ]);

    const output = await tool.execute(parseToolInput(tool, {}), ctx);

    expect(output.savedItems[0]?.visibilityLabel).toBeNull();
    expect(output.savedItems[0]?.visibilityChoice).toBeNull();
    expect(output.savedItems[0]?.ownership).toBe("household_native");
  });

  it("keeps the record id out of the model's context, since no tool takes one", async () => {
    const output = await tool.execute(parseToolInput(tool, {}), ctx);
    const model = toolModelValue(tool, output);

    expect(JSON.stringify(model)).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(JSON.stringify(model)).toContain("Roof quote");
  });

  it("reports an empty pile as a real answer, not a failure to search harder", async () => {
    mocks.listSavedItems.mockResolvedValue([]);

    const output = await tool.execute(parseToolInput(tool, {}), ctx);
    const model = toolModelValue(tool, output) as { savedItems: unknown[]; guidance: string };

    expect(model.savedItems).toEqual([]);
    expect(model.guidance).toMatch(/do not widen the search or invent an item/i);
  });

  it("curates a store failure instead of handing the model the query", async () => {
    mocks.listSavedItems.mockRejectedValue(
      new Error('Failed query: select * from "saved_items" params: user-1'),
    );

    await expect(tool.execute(parseToolInput(tool, {}), ctx)).rejects.toThrow(
      /Could not read the user's records right now/,
    );
  });
});

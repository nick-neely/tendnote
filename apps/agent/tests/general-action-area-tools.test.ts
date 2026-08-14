import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, parseToolInput, toolModelValue } from "./test-tool";

/**
 * Areas were write-only from Eve's side.
 *
 * Four tools have taken an `areaId` since Phase 5 and `skills/actions.md` told the
 * model to use one, but nothing listed Areas — so the only way to produce an id was
 * to invent a uuid, and the shared layer rejects an Area the owner does not own.
 * These pin the read that closes the loop, and the one projection that now names an
 * Area instead of dropping it.
 */
const mocks = vi.hoisted(() => ({
  listGeneralActionAreas: vi.fn(),
  listActiveGeneralActions: vi.fn(),
  listPausedGeneralActions: vi.fn(),
  listResolvedGeneralActions: vi.fn(),
  getOwnerTodayContext: vi.fn(),
}));

vi.mock("@tendnote/db/queries/general-action-areas", () => ({
  listGeneralActionAreas: mocks.listGeneralActionAreas,
}));
vi.mock("@tendnote/db/queries/general-actions", () => ({
  listActiveGeneralActions: mocks.listActiveGeneralActions,
  listPausedGeneralActions: mocks.listPausedGeneralActions,
  listResolvedGeneralActions: mocks.listResolvedGeneralActions,
}));
vi.mock("@tendnote/db/queries/today", () => ({
  getOwnerTodayContext: mocks.getOwnerTodayContext,
}));

const { default: rawAreasTool } = await import("../agent/tools/list_general_action_areas");
const { default: rawActionsTool } = await import("../agent/tools/list_general_actions");
const areasTool = asTestTool(rawAreasTool);
const actionsTool = asTestTool(rawActionsTool);

const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;

const AREA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function area(overrides: Record<string, unknown> = {}) {
  return {
    id: AREA_ID,
    ownerUserId: "owner-1",
    name: "Home",
    sortOrder: 0,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listGeneralActionAreas.mockResolvedValue([area()]);
  mocks.listActiveGeneralActions.mockResolvedValue([]);
});

describe("list_general_action_areas", () => {
  it("reads the session owner's Areas and never an owner named by the model", async () => {
    await areasTool.execute(parseToolInput(areasTool, {}), ctx);

    expect(mocks.listGeneralActionAreas).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      includeArchived: false,
    });
  });

  it("leaves archived Areas out by default and marks them when asked for", async () => {
    mocks.listGeneralActionAreas.mockResolvedValue([
      area(),
      area({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Old", archivedAt: new Date() }),
    ]);

    const output = await areasTool.execute(
      parseToolInput(areasTool, { includeArchived: true }),
      ctx,
    );

    expect(mocks.listGeneralActionAreas).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      includeArchived: true,
    });
    expect(output.areas.map((entry) => entry.archived)).toEqual([false, true]);
  });

  it("bounds what it hands back and says when it truncated", async () => {
    mocks.listGeneralActionAreas.mockResolvedValue([
      area({ id: "11111111-1111-4111-8111-111111111111", name: "Home" }),
      area({ id: "22222222-2222-4222-8222-222222222222", name: "Work" }),
      area({ id: "33333333-3333-4333-8333-333333333333", name: "Health" }),
    ]);

    const output = await areasTool.execute(parseToolInput(areasTool, { limit: 2 }), ctx);

    expect(output.count).toBe(2);
    expect(output.truncated).toBe(true);
    // The bound is the model's to raise, and it cannot go past the schema's ceiling.
    expect(() => parseToolInput(areasTool, { limit: 500 })).toThrow();
  });

  it("hands the model the id its filing tools take, and the name to say out loud", async () => {
    const output = await areasTool.execute(parseToolInput(areasTool, {}), ctx);
    const model = toolModelValue(areasTool, output) as {
      areas: Array<{ areaId: string; name: string }>;
      guidance: string;
    };

    // Without this the model can only invent a uuid, which the shared layer rejects.
    expect(model.areas).toEqual([{ areaId: AREA_ID, name: "Home", archived: false }]);
    expect(model.guidance).toMatch(/never guess or retype one/i);
    expect(model.guidance).toMatch(/never write an id in your reply/i);
  });

  it("tells the model to leave actions unfiled when there are no Areas at all", async () => {
    // Both empty cases — a user who never opened Actions, and one who archived every
    // Area — must produce a sentence that is true of each, since neither the tool nor
    // the model can tell them apart.
    mocks.listGeneralActionAreas.mockResolvedValue([]);

    const output = await areasTool.execute(parseToolInput(areasTool, {}), ctx);
    const model = toolModelValue(areasTool, output) as { guidance: string };

    expect(output.count).toBe(0);
    expect(model.guidance).toMatch(/omit `areaId`/);
    expect(model.guidance).toMatch(/cannot create, rename, or archive Areas/i);
  });

  it("curates a store failure instead of handing the model the query", async () => {
    mocks.listGeneralActionAreas.mockRejectedValue(
      new Error('Failed query: select * from "general_action_areas" params: owner-1'),
    );

    await expect(areasTool.execute(parseToolInput(areasTool, {}), ctx)).rejects.toThrow(
      /Could not read the user's records right now/,
    );
  });
});

describe("list_general_actions names the Area an action is filed under", () => {
  function action(overrides: Record<string, unknown> = {}) {
    return {
      id: "44444444-4444-4444-4444-444444444444",
      title: "Replace the fridge water filter",
      status: "open",
      dueAt: null,
      deferUntil: null,
      recurrence: null,
      areaId: AREA_ID,
      linkedPeople: [],
      scope: "private",
      ...overrides,
    };
  }

  it("resolves the Area to a name beside the id that re-files it", async () => {
    mocks.listActiveGeneralActions.mockResolvedValue([action()]);

    const output = await actionsTool.execute(parseToolInput(actionsTool, {}), ctx);
    const model = toolModelValue(actionsTool, output) as {
      actions: Array<{ area: { id: string; name: string } | null }>;
    };

    // Archived Areas are read too: an action filed under one the owner later archived
    // is still filed there, and "Home" beats saying nothing.
    expect(mocks.listGeneralActionAreas).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      includeArchived: true,
    });
    expect(model.actions[0]?.area).toEqual({ id: AREA_ID, name: "Home" });
  });

  it("says nothing at all about an Area it cannot name", async () => {
    // The old behaviour for the case that has not changed: an unnamed id is exactly
    // the thing this projection drops, so an unfiled action carries no area field
    // content and a stale id never arrives as an unexplained uuid.
    mocks.listGeneralActionAreas.mockResolvedValue([]);
    mocks.listActiveGeneralActions.mockResolvedValue([action(), action({ areaId: null })]);

    const output = await actionsTool.execute(parseToolInput(actionsTool, {}), ctx);
    const model = toolModelValue(actionsTool, output) as {
      actions: Array<{ area: unknown }>;
    };

    expect(model.actions.map((entry) => entry.area)).toEqual([null, null]);
    expect(JSON.stringify(model.actions)).not.toContain(AREA_ID);
  });
});

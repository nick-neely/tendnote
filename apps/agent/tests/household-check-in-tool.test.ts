import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const { getHouseholdCheckin } = vi.hoisted(() => ({ getHouseholdCheckin: vi.fn() }));
vi.mock("@tendnote/db/queries/household-home", () => ({ getHouseholdCheckin }));

const { getOwnerTodayContext } = vi.hoisted(() => ({ getOwnerTodayContext: vi.fn() }));
vi.mock("@tendnote/db/queries/today", () => ({ getOwnerTodayContext }));

const { default: rawTool } = await import("../agent/tools/household_check_in");
const tool = asTestTool(rawTool);
const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function view(overrides: Record<string, unknown> = {}) {
  return {
    household: { id: "household-1", name: "Ash Lane" },
    optedIn: true,
    limitations: [],
    records: [
      {
        identity: "action:a1",
        family: "action",
        section: "needs_attention",
        pressing: true,
        record: { kind: "general_action", id: "action-1", href: "/actions#action-1" },
        title: "Put the bins out",
        context: "Routine · weekly",
        timing: { code: "due_today", explanation: "Due today" },
        scopeLabel: "Household",
        responsibility: "Mara is looking after this",
        progress: null,
        at: new Date("2026-07-21T09:00:00.000Z"),
        createdAt: new Date("2026-07-01T09:00:00.000Z"),
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getOwnerTodayContext.mockResolvedValue({
    localDate: "2026-07-21",
    timeZone: "Europe/London",
    now: new Date("2026-07-21T09:00:00.000Z"),
  });
});

describe("household_check_in", () => {
  it("takes no household, member, or scope argument at all", () => {
    // The whole caller-scoping property: the caller's own membership is both the
    // lookup key and the standing, so there is no argument shape a model could
    // produce that points this at a workspace they are not currently in.
    const shape = (tool.inputSchema as { shape?: Record<string, unknown> }).shape ?? {};
    expect(Object.keys(shape)).toEqual([]);
  });

  it("reads the composition for the session's caller in their own local day", async () => {
    getHouseholdCheckin.mockResolvedValue(view());

    await tool.execute({}, ctx);

    expect(getOwnerTodayContext).toHaveBeenCalledWith({ ownerUserId: "user-1" });
    expect(getHouseholdCheckin).toHaveBeenCalledWith({
      callerUserId: "user-1",
      localDate: "2026-07-21",
      timeZone: "Europe/London",
      now: new Date("2026-07-21T09:00:00.000Z"),
    });
  });

  it("hands the model records and a household name, and no ids to write down", async () => {
    getHouseholdCheckin.mockResolvedValue(view());

    const output = await tool.execute({}, ctx);
    const model = tool.toModelOutput?.(output) as { value: Record<string, unknown> };
    const serialized = JSON.stringify(model.value);

    expect(model.value).toMatchObject({
      household: "Ash Lane",
      count: 1,
      records: [
        {
          title: "Put the bins out",
          whose: "Household",
          lookingAfterIt: "Mara is looking after this",
        },
      ],
    });
    // No record ids and no hrefs: nothing here is a handle for a follow-up call,
    // so an id in context could only end up in a reply.
    expect(serialized).not.toContain("action-1");
    expect(serialized).not.toContain("/actions#");
    // No household id either — the name is what a person is told.
    expect(serialized).not.toContain("household-1");
  });

  it("reports an empty household as empty, with nothing to speculate from", async () => {
    getHouseholdCheckin.mockResolvedValue(view({ records: [] }));

    const output = await tool.execute({}, ctx);
    const model = tool.toModelOutput?.(output) as { value: { count: number; records: unknown[] } };

    expect(model.value).toMatchObject({ count: 0, records: [] });
  });

  it("gives a member who has left no household and no records", async () => {
    getHouseholdCheckin.mockResolvedValue(view({ household: null, records: [], optedIn: true }));

    const output = await tool.execute({}, ctx);
    const model = tool.toModelOutput?.(output) as { value: Record<string, unknown> };

    expect(model.value).toMatchObject({ household: null, count: 0, records: [] });
  });

  it("says a family could not be read rather than reporting a quiet household", async () => {
    getHouseholdCheckin.mockResolvedValue(
      view({ records: [], limitations: ["The check-in is temporarily unavailable."] }),
    );

    const output = await tool.execute({}, ctx);
    const model = tool.toModelOutput?.(output) as { value: { limitations: string[] } };

    expect(model.value.limitations).toEqual(["The check-in is temporarily unavailable."]);
  });
});

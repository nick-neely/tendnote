import type { GeneralActionWithContext } from "@tendnote/db/queries/general-actions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const mocks = vi.hoisted(() => ({
  createGeneralAction: vi.fn(),
  suggestGeneralAction: vi.fn(),
  listActiveGeneralActions: vi.fn(),
  listPausedGeneralActions: vi.fn(),
  listResolvedGeneralActions: vi.fn(),
  completeGeneralAction: vi.fn(),
  deferGeneralAction: vi.fn(),
  dismissGeneralAction: vi.fn(),
  reopenGeneralAction: vi.fn(),
  archiveGeneralAction: vi.fn(),
  pauseGeneralAction: vi.fn(),
  resumeGeneralAction: vi.fn(),
  editGeneralAction: vi.fn(),
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
  getOwnerTodayContext: vi.fn(),
}));

/**
 * The commit boundary, recorded rather than opened.
 *
 * `plan_suggested_general_actions` writes every step inside one
 * `withDatabaseTransaction`. Unmocked, that reaches the real `getDb()` - which
 * falls back to the local dev database URL, so this suite would quietly stop
 * being a unit test and start depending on a running Postgres.
 */
const { withDatabaseTransaction } = vi.hoisted(() => ({
  withDatabaseTransaction: vi.fn(<T>(run: () => Promise<T>) => run()),
}));

// Partial: `list_general_actions` reaches the real client through the Areas store, so
// only the boundary is replaced.
vi.mock("@tendnote/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tendnote/db/client")>()),
  withDatabaseTransaction,
}));
vi.mock("@tendnote/db/queries/general-actions", () => mocks);
// The ledger's date windows are measured against the OWNER's day, so the list tool
// reads it. Mocked here so this suite stays a pure unit test of the filters.
vi.mock("@tendnote/db/queries/today", () => ({
  getOwnerTodayContext: mocks.getOwnerTodayContext,
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation: mocks.requestBackgroundAffectedScopeReconciliation,
}));

const { default: rawCreateTool } = await import("../agent/tools/create_general_action");
const { default: rawSuggestTool } = await import("../agent/tools/suggest_general_action");
const { default: rawPlanTool, MAX_SHALLOW_PLAN_ACTIONS } = await import(
  "../agent/tools/plan_suggested_general_actions"
);
const { default: rawListTool } = await import("../agent/tools/list_general_actions");
const { default: rawUpdateTool } = await import("../agent/tools/update_general_action_status");
const { default: rawEditTool } = await import("../agent/tools/edit_general_action");
const createTool = asTestTool(rawCreateTool);
const suggestTool = asTestTool(rawSuggestTool);
const planTool = asTestTool(rawPlanTool);
const listTool = asTestTool(rawListTool);
const updateTool = asTestTool(rawUpdateTool);
const editTool = asTestTool(rawEditTool);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;
const ACTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// A valid RFC-variant UUID: the cap test parses this through the tool's z.uuid() schema.
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

/** A hydrated General Action fixture (GeneralActionWithContext) for tool output shaping. */
function action(overrides: Partial<GeneralActionWithContext> = {}): GeneralActionWithContext {
  return {
    id: ACTION_ID,
    ownerUserId: "user-1",
    ownership: "member_owned",
    responsibilityHolderUserId: null,
    occurrenceVersion: 0,
    title: "Replace the fridge water filter",
    notes: null,
    links: [],
    status: "open",
    dueAt: null,
    deferUntil: null,
    sourceRecordId: null,
    areaId: null,
    scope: "private",
    householdId: null,
    assetHints: [],
    recurrence: null,
    createdByUserId: "user-1",
    lastActorUserId: "user-1",
    completedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    linkedPeople: [],
    sharedWithCount: 0,
    householdName: null,
    ...overrides,
  };
}

function mutationOutcome<TResult>(result: TResult) {
  return { result, affectedScopes: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOwnerTodayContext.mockResolvedValue({
    localDate: new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date()),
    timeZone: "UTC",
    now: new Date(),
  });
});

describe("create_general_action — explicit active creation", () => {
  it("creates an unscheduled active action owner-scoped, without a due date", async () => {
    mocks.createGeneralAction.mockResolvedValue(mutationOutcome(action()));

    const result = await createTool.execute({ title: "Replace the fridge water filter" }, ctx);

    expect(mocks.createGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        title: "Replace the fridge water filter",
        dueAt: null,
        recurrence: null,
      }),
    );
    expect(result.action.id).toBe(ACTION_ID);
    expect(result.action.status).toBe("open");
    expect(result.action.isRoutine).toBe(false);
    expect(mocks.requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([]);
  });

  it("parses a concrete due date and a cadence into a Routine", async () => {
    mocks.createGeneralAction.mockResolvedValue(
      mutationOutcome(
        action({
          dueAt: new Date("2026-08-01T00:00:00.000Z"),
          recurrence: { interval: 6, unit: "month" },
        }),
      ),
    );

    const result = await createTool.execute(
      {
        title: "Change the HVAC filter",
        dueAt: "2026-08-01",
        recurrence: { interval: 6, unit: "month" },
      },
      ctx,
    );

    const passed = mocks.createGeneralAction.mock.calls[0]?.[0];
    expect(passed.dueAt).toBeInstanceOf(Date);
    expect(passed.recurrence).toEqual({ interval: 6, unit: "month" });
    expect(result.action.isRoutine).toBe(true);
    expect(result.action.recurrence).toBe("Every 6 months");
  });

  it("keeps the action id for follow-up tool calls and the title for prose", () => {
    const model = createTool.toModelOutput?.({ action: { ...toRef() } } as never) as {
      value: unknown;
    };
    const serialized = JSON.stringify(model.value);
    expect(serialized).toContain("Replace the fridge water filter");
    expect(serialized).toContain(ACTION_ID);
  });
});

/** The compact ref shape create/edit/update tools return (matches toGeneralActionRef). */
function toRef() {
  return {
    id: ACTION_ID,
    title: "Replace the fridge water filter",
    status: "open" as const,
    dueAt: null,
    deferUntil: null,
    isRoutine: false,
    recurrence: null,
    areaId: null,
    people: [],
    visibilityChoice: "only_me" as const,
    visibilityLabel: "Only me",
  };
}

describe("suggest_general_action — grounded, review-gated proposal", () => {
  it("proposes a suggestion grounded in a source record, never active", async () => {
    mocks.suggestGeneralAction.mockResolvedValue(
      mutationOutcome({
        action: action({ status: "suggested" }),
        sourceRecord: { id: SOURCE_ID },
        component: {
          type: "suggested_general_action_review",
          generalActionId: ACTION_ID,
          sourceRecordId: SOURCE_ID,
        },
      }),
    );

    const result = await suggestTool.execute(
      { title: "Book the campsite", sourceRecordId: SOURCE_ID },
      ctx,
    );

    expect(mocks.suggestGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-1", sourceRecordId: SOURCE_ID }),
    );
    expect(mocks.createGeneralAction).not.toHaveBeenCalled();
    expect(result.action.status).toBe("suggested");
    expect(result.component.type).toBe("suggested_general_action_review");
  });
});

describe("plan_suggested_general_actions — shallow planning", () => {
  it("proposes each step through the review-gated seam, grounded, never active", async () => {
    mocks.suggestGeneralAction.mockImplementation(async (input: { title: string }) =>
      mutationOutcome({
        action: action({ title: input.title, status: "suggested" }),
        sourceRecord: { id: SOURCE_ID },
        component: {
          type: "suggested_general_action_review",
          generalActionId: ACTION_ID,
          sourceRecordId: SOURCE_ID,
        },
      }),
    );

    const result = await planTool.execute(
      {
        sourceRecordId: SOURCE_ID,
        steps: [
          { title: "Book the campsite" },
          { title: "Rent the gear" },
          { title: "Plan the meals" },
        ],
      },
      ctx,
    );

    expect(mocks.suggestGeneralAction).toHaveBeenCalledTimes(3);
    // Every step is grounded in the one planning source record.
    for (const call of mocks.suggestGeneralAction.mock.calls) {
      expect(call[0].sourceRecordId).toBe(SOURCE_ID);
      expect(call[0].ownerUserId).toBe("user-1");
    }
    expect(mocks.createGeneralAction).not.toHaveBeenCalled();
    expect(result.count).toBe(3);
  });

  it("caps the plan at a small number of steps in its input schema", () => {
    // inputSchema is the zod object at runtime (the Standard-schema type hides safeParse).
    const schema = planTool.inputSchema as unknown as {
      safeParse: (value: unknown) => { success: boolean };
    };
    const tooMany = Array.from({ length: MAX_SHALLOW_PLAN_ACTIONS + 1 }, (_, i) => ({
      title: `Step ${i}`,
    }));
    expect(schema.safeParse({ sourceRecordId: SOURCE_ID, steps: tooMany }).success).toBe(false);
    expect(
      schema.safeParse({ sourceRecordId: SOURCE_ID, steps: [{ title: "Only step" }] }).success,
    ).toBe(true);
  });

  /**
   * A plan is one thing, so it commits as one thing. Each step used to be its own
   * commit: a failure at step k left k-1 suggestions in the user's review queue
   * and told the model the whole call had failed - half a plan nobody asked for,
   * reported as nothing at all.
   */
  it("writes every step inside one transaction", async () => {
    mocks.suggestGeneralAction.mockImplementation(async (input: { title: string }) =>
      mutationOutcome({
        action: action({ title: input.title, status: "suggested" }),
        sourceRecord: { id: SOURCE_ID },
        component: { type: "suggested_general_action_review" },
      }),
    );

    await planTool.execute(
      {
        sourceRecordId: SOURCE_ID,
        steps: [{ title: "Book the campsite" }, { title: "Rent the gear" }],
      },
      ctx,
    );

    expect(withDatabaseTransaction).toHaveBeenCalledTimes(1);
    const boundary = withDatabaseTransaction.mock.invocationCallOrder[0] as number;
    for (const order of mocks.suggestGeneralAction.mock.invocationCallOrder) {
      expect(order).toBeGreaterThan(boundary);
    }
  });

  it("rolls the earlier steps back when a later one fails, and reconciles nothing", async () => {
    let written = 0;
    mocks.suggestGeneralAction.mockImplementation(async (input: { title: string }) => {
      written += 1;
      if (written === 3) throw new Error('Failed query: insert into "general_actions" ...');
      return mutationOutcome({
        action: action({ title: input.title, status: "suggested" }),
        sourceRecord: { id: SOURCE_ID },
        component: { type: "suggested_general_action_review" },
      });
    });

    await expect(
      planTool.execute(
        {
          sourceRecordId: SOURCE_ID,
          steps: [{ title: "One" }, { title: "Two" }, { title: "Three" }],
        },
        ctx,
      ),
    ).rejects.toThrow(/could not read the user's records/i);

    // Two steps were attempted before the third failed, and the rejection escaped the
    // boundary - so a real transaction discards all three rather than leaving two
    // orphans behind a "nothing happened" error.
    expect(written).toBe(3);
    await expect(withDatabaseTransaction.mock.results[0]?.value).rejects.toThrow();
    // Reconciliation runs only after a commit, so a rolled-back plan never reaches
    // the cache as if it existed.
    expect(mocks.requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });
});

describe("update_general_action_status — explicit, single-record mutation", () => {
  it.each([
    ["complete", "completeGeneralAction"],
    ["dismiss", "dismissGeneralAction"],
    ["reopen", "reopenGeneralAction"],
    ["archive", "archiveGeneralAction"],
    ["pause", "pauseGeneralAction"],
    ["resume", "resumeGeneralAction"],
  ] as const)("dispatches %s to the shared lifecycle function", async (action_, fnName) => {
    mocks[fnName].mockResolvedValue(mutationOutcome(action()));

    await updateTool.execute({ generalActionId: ACTION_ID, action: action_ }, ctx);

    expect(mocks[fnName]).toHaveBeenCalledWith({
      actorUserId: "user-1",
      generalActionId: ACTION_ID,
    });
    expect(mocks.requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([]);
  });

  it("defers to a concrete resurface date", async () => {
    mocks.deferGeneralAction.mockResolvedValue(mutationOutcome(action({ status: "deferred" })));

    await updateTool.execute(
      { generalActionId: ACTION_ID, action: "defer", deferUntil: "2026-09-01" },
      ctx,
    );

    const passed = mocks.deferGeneralAction.mock.calls[0]?.[0];
    expect(passed.deferUntil).toBeInstanceOf(Date);
    expect(passed.actorUserId).toBe("user-1");
  });

  it("refuses to defer without a resurface date", async () => {
    await expect(
      updateTool.execute({ generalActionId: ACTION_ID, action: "defer" }, ctx),
    ).rejects.toThrow(/resurface date/i);
    expect(mocks.deferGeneralAction).not.toHaveBeenCalled();
  });

  /**
   * The pairing lived only in the executor, so the model met it as a thrown error
   * after the call rather than as a rule before it - and the other half was not
   * checked at all: `{action:"complete", deferUntil:"…"}` parsed, dropped the date,
   * and completed the action. "Push this to Friday" ending as "done" is the worst
   * outcome this tool has.
   */
  describe("deferUntil belongs to exactly one transition", () => {
    const schema = () =>
      updateTool.inputSchema as unknown as {
        safeParse: (value: unknown) => {
          success: boolean;
          error?: { issues: Array<{ message: string }> };
        };
      };

    it("rejects defer with no date, naming the field to pass", () => {
      const parsed = schema().safeParse({ generalActionId: ACTION_ID, action: "defer" });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toMatch(/deferUntil/);
      expect(parsed.error?.issues[0]?.message).toMatch(/iso 8601/i);
    });

    it("rejects a date on any other transition, and says what it would have done", () => {
      const parsed = schema().safeParse({
        generalActionId: ACTION_ID,
        action: "complete",
        deferUntil: "2026-09-01",
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toMatch(/would have applied "complete"/i);
      expect(parsed.error?.issues[0]?.message).toMatch(/edit_general_action/);
    });

    it("accepts each transition in its one valid shape", () => {
      expect(
        schema().safeParse({
          generalActionId: ACTION_ID,
          action: "defer",
          deferUntil: "2026-09-01",
        }).success,
      ).toBe(true);
      expect(schema().safeParse({ generalActionId: ACTION_ID, action: "complete" }).success).toBe(
        true,
      );
    });
  });
});

describe("edit_general_action — content edit only on named record", () => {
  it("builds a sparse edit: converts a due date, clears with null, omits unset keys", async () => {
    mocks.editGeneralAction.mockResolvedValue(
      mutationOutcome(action({ title: "Renew the passport" })),
    );

    await editTool.execute(
      { generalActionId: ACTION_ID, title: "Renew the passport", notes: null, dueAt: "2026-10-01" },
      ctx,
    );

    const passed = mocks.editGeneralAction.mock.calls[0]?.[0];
    expect(passed.actorUserId).toBe("user-1");
    expect(passed.edit.title).toBe("Renew the passport");
    expect(passed.edit.notes).toBeNull();
    expect(passed.edit.dueAt).toBeInstanceOf(Date);
    // Untouched fields are absent, so the shared layer never wipes them.
    expect("areaId" in passed.edit).toBe(false);
    expect("recurrence" in passed.edit).toBe(false);
    expect(mocks.requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([]);
  });
});

describe("list_general_actions — ledger routing and window filtering", () => {
  it("routes to the paused ledger for routinesOnly paused reads", async () => {
    mocks.listPausedGeneralActions.mockResolvedValue([
      action({ status: "paused", recurrence: { interval: 1, unit: "week" } }),
    ]);

    const result = await listTool.execute({ ledger: "paused", routinesOnly: true }, ctx);

    expect(mocks.listPausedGeneralActions).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      limit: undefined,
    });
    expect(mocks.listActiveGeneralActions).not.toHaveBeenCalled();
    expect(result.count).toBe(1);
    expect(result.actions[0]?.isRoutine).toBe(true);
  });

  it("filters the active ledger to unscheduled actions", async () => {
    mocks.listActiveGeneralActions.mockResolvedValue([
      action({
        id: "11111111-1111-1111-1111-111111111111",
        dueAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
      action({ id: "33333333-3333-3333-3333-333333333333", dueAt: null, deferUntil: null }),
    ]);

    const result = await listTool.execute({ window: "unscheduled" }, ctx);

    expect(result.count).toBe(1);
    expect(result.actions[0]?.dueAt).toBeNull();
  });

  it("filters the active ledger to overdue actions by surfacing time", async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mocks.listActiveGeneralActions.mockResolvedValue([
      action({ id: "11111111-1111-1111-1111-111111111111", dueAt: past }),
      action({ id: "33333333-3333-3333-3333-333333333333", dueAt: future }),
    ]);

    const result = await listTool.execute({ window: "overdue" }, ctx);

    expect(result.count).toBe(1);
  });
});

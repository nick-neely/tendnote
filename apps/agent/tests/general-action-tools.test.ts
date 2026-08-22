import type { GeneralActionWithContext } from "@tendnote/db/queries/general-actions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, parseToolInput } from "./test-tool";

const mocks = vi.hoisted(() => ({
  createGeneralAction: vi.fn(),
  createGeneralActionWithReminder: vi.fn(),
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
  listGeneralActionAreas: vi.fn(),
  getOwnerTodayContext: vi.fn(),
  currentAuthenticatedTurnMessage: vi.fn(),
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

// Partial, so only the transaction boundary is replaced and the rest of the
// client module keeps its real shape.
vi.mock("@tendnote/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tendnote/db/client")>()),
  withDatabaseTransaction,
}));
vi.mock("@tendnote/db/queries/general-actions", () => mocks);
// `list_general_actions` reads the owner's Areas alongside the ledger. Unmocked
// that is a real query, so the suite passed only where a Postgres happened to be
// listening on the configured URL and failed in CI, where none is.
vi.mock("@tendnote/db/queries/general-action-areas", () => ({
  listGeneralActionAreas: mocks.listGeneralActionAreas,
}));
// The ledger's date windows are measured against the OWNER's day, so the list tool
// reads it. Mocked here so this suite stays a pure unit test of the filters.
vi.mock("@tendnote/db/queries/today", () => ({
  getOwnerTodayContext: mocks.getOwnerTodayContext,
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation: mocks.requestBackgroundAffectedScopeReconciliation,
}));
vi.mock("../agent/lib/current-turn-message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/lib/current-turn-message")>()),
  currentAuthenticatedTurnMessage: mocks.currentAuthenticatedTurnMessage,
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

const ctx = {
  session: {
    auth: { current: { principalId: "user-1" } },
    turn: { id: "turn-1", sequence: 0 },
  },
} as never;
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
  mocks.currentAuthenticatedTurnMessage.mockReturnValue(
    "Move Replace the fridge water filter to October 1, 2026.",
  );
  mocks.listGeneralActionAreas.mockResolvedValue([]);
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

  it("keeps an explicit Action valid and unfiled when no Area is supplied", async () => {
    mocks.createGeneralAction.mockResolvedValue(mutationOutcome(action({ areaId: null })));

    const result = await createTool.execute({ title: "Descale the kettle" }, ctx);
    const model = createTool.toModelOutput?.(result as never) as {
      value: { action: { area: unknown } };
    };

    expect(mocks.createGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Descale the kettle", areaId: null }),
    );
    expect(model.value.action.area).toBeNull();
    // Filing is an optional follow-up, not a side effect of direct creation. The
    // model must resolve an Area first when one was explicitly requested.
    expect(mocks.listGeneralActionAreas).not.toHaveBeenCalled();
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

  it("attaches an explicit reminder in the owner's timezone without an agent installation", async () => {
    mocks.createGeneralActionWithReminder.mockResolvedValue(
      mutationOutcome({
        action: action({ dueAt: new Date("2026-08-16T00:00:00.000Z") }),
        reminder: {
          status: "scheduled",
          schedule: {
            kind: "exact",
            localTime: "15:00",
            leadMinutes: null,
            timeZone: "America/Chicago",
            intendedAt: new Date("2026-08-16T20:00:00.000Z"),
          },
          occurrenceIntent: { id: "intent-1" },
          optIn: { state: "none", clientInstallationId: null },
        },
      }),
    );
    mocks.getOwnerTodayContext.mockResolvedValue({
      localDate: "2026-08-15",
      timeZone: "America/Chicago",
      now: new Date("2026-08-15T17:00:00.000Z"),
    });

    const result = await createTool.execute(
      {
        title: "Replace the fridge water filter",
        dueAt: "2026-08-16",
        reminderSchedule: { kind: "exact", localTime: "15:00" },
      },
      ctx,
    );

    expect(mocks.createGeneralActionWithReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        dueAt: new Date("2026-08-16T00:00:00.000Z"),
        reminder: {
          schedule: { kind: "exact", localTime: "15:00" },
          timeZone: "America/Chicago",
          now: new Date("2026-08-15T17:00:00.000Z"),
        },
      }),
    );
    expect(mocks.createGeneralActionWithReminder.mock.calls[0]?.[0]).not.toHaveProperty(
      "clientInstallationId",
    );
    expect(result.reminder).toMatchObject({
      status: "scheduled",
      timeZone: "America/Chicago",
      intendedAt: "2026-08-16T20:00:00.000Z",
    });
    expect(mocks.createGeneralAction).not.toHaveBeenCalled();
  });

  it("reports a saved action and failed notification scheduling separately", async () => {
    mocks.createGeneralActionWithReminder.mockResolvedValue(
      mutationOutcome({
        action: action({ dueAt: new Date("2026-08-16T00:00:00.000Z") }),
        reminder: { status: "failed", reason: "unavailable" },
      }),
    );
    mocks.getOwnerTodayContext.mockResolvedValue({
      localDate: "2026-08-15",
      timeZone: "America/Chicago",
      now: new Date("2026-08-15T17:00:00.000Z"),
    });

    const result = await createTool.execute(
      {
        title: "Replace the fridge water filter",
        dueAt: "2026-08-16",
        reminderSchedule: { kind: "exact", localTime: "15:00" },
      },
      ctx,
    );

    expect(result.action.id).toBe(ACTION_ID);
    expect(result.reminder).toEqual({ status: "failed", reason: "unavailable" });
    const model = createTool.toModelOutput?.(result as never) as { value: { guidance: string } };
    expect(model.value.guidance).toMatch(/action was created/i);
    expect(model.value.guidance).toMatch(/not.*scheduled/i);
  });

  it("confirms an arbitrary lead time with its concrete intended instant", async () => {
    mocks.createGeneralActionWithReminder.mockResolvedValue(
      mutationOutcome({
        action: action({ dueAt: new Date("2026-08-16T00:00:00.000Z") }),
        reminder: {
          status: "scheduled",
          schedule: {
            kind: "relative",
            localTime: null,
            leadMinutes: 123,
            timeZone: "America/Chicago",
            intendedAt: new Date("2026-08-16T11:57:00.000Z"),
          },
          occurrenceIntent: { id: "intent-1" },
          optIn: { state: "none", clientInstallationId: null },
        },
      }),
    );
    mocks.getOwnerTodayContext.mockResolvedValue({
      localDate: "2026-08-15",
      timeZone: "America/Chicago",
      now: new Date("2026-08-15T17:00:00.000Z"),
    });

    const result = await createTool.execute(
      {
        title: "Replace the fridge water filter",
        dueAt: "2026-08-16",
        reminderSchedule: { kind: "relative", leadMinutes: 123 },
      },
      ctx,
    );

    expect(result.reminder).toMatchObject({
      status: "scheduled",
      intendedAt: "2026-08-16T11:57:00.000Z",
    });
    if (result.reminder?.status !== "scheduled") {
      throw new Error("Expected a scheduled custom reminder.");
    }
    expect(result.reminder.label).toContain("2 hours 3 minutes before");
    expect(result.reminder.label).toContain("2026-08-16");
    expect(result.reminder.label).not.toContain("occurrence time");
  });

  it("requires a concrete action date before accepting a reminder schedule", async () => {
    await expect(
      createTool.execute(
        {
          title: "Replace the fridge water filter",
          reminderSchedule: { kind: "exact", localTime: "15:00" },
        },
        ctx,
      ),
    ).rejects.toThrow(/concrete.*date|due date/i);
    expect(mocks.createGeneralAction).not.toHaveBeenCalled();
    expect(mocks.createGeneralActionWithReminder).not.toHaveBeenCalled();
  });

  it("rejects a normalized impossible calendar date before creating an Action", async () => {
    await expect(
      createTool.execute(
        {
          title: "Replace the fridge water filter",
          dueAt: "2026-02-30",
        },
        ctx,
      ),
    ).rejects.toThrow(/real calendar date/i);
    expect(mocks.createGeneralAction).not.toHaveBeenCalled();
    expect(mocks.createGeneralActionWithReminder).not.toHaveBeenCalled();

    await expect(
      createTool.execute(
        {
          title: "Replace the fridge water filter",
          dueAt: "2026-02-30 00:00:00",
        },
        ctx,
      ),
    ).rejects.toThrow(/real calendar date|ISO 8601/i);
  });

  it("schemas due dates as canonical ISO dates or offset date-times before parsing", () => {
    expect(() =>
      parseToolInput(rawCreateTool, {
        title: "Replace the fridge water filter",
        dueAt: "2026-02-30 00:00:00",
      }),
    ).toThrow();
    expect(() =>
      parseToolInput(rawCreateTool, {
        title: "Replace the fridge water filter",
        dueAt: "2026-08-16 00:00:00Z",
      }),
    ).toThrow();
    expect(
      parseToolInput(rawCreateTool, {
        title: "Replace the fridge water filter",
        dueAt: "2026-08-16",
      }),
    ).toMatchObject({ dueAt: "2026-08-16" });
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
      const message = parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "";
      expect(message).toContain('would have applied "complete"');
      expect(message).toContain("edit_general_action");
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
  it("rejects delegated target and due-time selection before any database mutation", async () => {
    mocks.currentAuthenticatedTurnMessage.mockReturnValue(
      "Pick whichever task you think is my highest priority today and set an alert at whatever time you think is best. Do not ask me; use your judgment.",
    );

    const result = await editTool.execute(
      { generalActionId: ACTION_ID, dueAt: "2026-08-20T09:00:00-05:00" },
      ctx,
    );

    expect(result).toMatchObject({
      updated: false,
      authorization: "rejected",
      guidance: expect.stringMatching(/specific Action.*user-supplied|delegated/i),
    });
    expect(mocks.editGeneralAction).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });

  it("allows an explicit named target with a user-supplied concrete date", async () => {
    mocks.currentAuthenticatedTurnMessage.mockReturnValue(
      "Move Replace the fridge water filter to October 1, 2026.",
    );
    mocks.editGeneralAction.mockResolvedValue(
      mutationOutcome(action({ dueAt: new Date("2026-10-01T00:00:00.000Z") })),
    );

    await editTool.execute({ generalActionId: ACTION_ID, dueAt: "2026-10-01" }, ctx);

    expect(mocks.editGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        generalActionId: ACTION_ID,
        edit: expect.objectContaining({ dueAt: new Date("2026-10-01T00:00:00.000Z") }),
      }),
    );
  });

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

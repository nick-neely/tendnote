import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeneralAction, GeneralActionRecurrence } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  type ActionSummaryWorkflowResult,
  actionSummaryArtifactId,
  createActionSummaryDispatch,
  createActionSummaryWorkflow,
  selectActionSummaryItems,
  toActionSummaryArtifact,
} from "./action-summary";
import {
  createInMemoryScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
} from "./scheduled-workflow-deliveries";

const OWNER = "owner-1";
const HOUSEHOLD_ID = "55555555-5555-5555-5555-555555555555";
const OTHER_HOUSEHOLD_ID = "66666666-6666-6666-6666-666666666666";
// Due dates are stored at local midnight, so fixtures use local Date construction to
// stay timezone-independent (matching the domain classifier's day comparison).
const NOW = new Date(2026, 6, 6, 9, 0, 0);
const LOCAL_DATE = "2026-07-06";

let seq = 0;

function action(overrides: Partial<GeneralAction> = {}): GeneralAction {
  seq += 1;
  return {
    id: `action-${seq}`,
    ownerUserId: OWNER,
    title: `Action ${seq}`,
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
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const WEEKLY: GeneralActionRecurrence = { interval: 1, unit: "week" };

describe("action summary selection", () => {
  it("selects only due, overdue, and resurfaced actions, tagged with why they surfaced", () => {
    const dueToday = action({ id: "due", dueAt: new Date(2026, 6, 6) });
    const overdue = action({ id: "overdue", dueAt: new Date(2026, 6, 1) });
    const resurfaced = action({
      id: "resurfaced",
      status: "deferred",
      deferUntil: new Date(2026, 6, 5),
    });
    // None of these surface: an unscheduled someday action, a future-dated one, a
    // not-yet-arrived deferral, a paused Routine, a completed action, and the two
    // review-gated proposals — a `suggested` and an `ignored` one are not durable
    // actions and never reach a proactive surface even with a past due date (ADRs
    // 0151, 0152).
    const unscheduled = action({ id: "unscheduled" });
    const future = action({ id: "future", dueAt: new Date(2026, 6, 20) });
    const notYet = action({ id: "not-yet", status: "deferred", deferUntil: new Date(2026, 7, 1) });
    const paused = action({ id: "paused", status: "paused", dueAt: new Date(2026, 0, 1) });
    const done = action({ id: "done", status: "completed", dueAt: new Date(2026, 0, 1) });
    const suggested = action({ id: "suggested", status: "suggested", dueAt: new Date(2026, 0, 1) });
    const ignored = action({ id: "ignored", status: "ignored", dueAt: new Date(2026, 0, 1) });

    const items = selectActionSummaryItems(
      [
        dueToday,
        overdue,
        resurfaced,
        unscheduled,
        future,
        notYet,
        paused,
        done,
        suggested,
        ignored,
      ],
      NOW,
    );

    expect(items.map((item) => [item.action.id, item.reason])).toEqual([
      ["due", "due_today"],
      ["overdue", "overdue"],
      ["resurfaced", "resurfaced"],
    ]);
  });

  it("surfaces a recurring Routine through its rolled-forward due date", () => {
    const dueRoutine = action({
      id: "routine-due",
      recurrence: WEEKLY,
      dueAt: new Date(2026, 6, 6),
    });
    const futureRoutine = action({
      id: "routine-future",
      recurrence: WEEKLY,
      dueAt: new Date(2026, 6, 13),
    });

    const items = selectActionSummaryItems([dueRoutine, futureRoutine], NOW);

    expect(items.map((item) => item.action.id)).toEqual(["routine-due"]);
    expect(items[0]?.reason).toBe("due_today");
  });
});

describe("action summary artifact scope", () => {
  it("carries household scope only when every surfacing item is household-visible for one household", () => {
    const items = selectActionSummaryItems(
      [
        action({ dueAt: new Date(2026, 6, 6), scope: "household", householdId: HOUSEHOLD_ID }),
        action({ dueAt: new Date(2026, 6, 1), scope: "household", householdId: HOUSEHOLD_ID }),
      ],
      NOW,
    );

    const artifact = toActionSummaryArtifact({ ownerUserId: OWNER, localDate: LOCAL_DATE, items });

    expect(artifact).toMatchObject({
      workflow: "action_summary",
      artifactKind: "action_summary",
      artifactId: "action_summary:2026-07-06",
      sensitivity: "normal",
      scope: "household",
      householdId: HOUSEHOLD_ID,
      persisted: true,
      summary: "2 actions are ready for today.",
    });
  });

  it("fails closed to private when any surfacing item is private or selected-shared", () => {
    const withPrivate = selectActionSummaryItems(
      [
        action({ dueAt: new Date(2026, 6, 6), scope: "household", householdId: HOUSEHOLD_ID }),
        action({ dueAt: new Date(2026, 6, 6), scope: "private" }),
      ],
      NOW,
    );
    const withShared = selectActionSummaryItems(
      [
        action({ dueAt: new Date(2026, 6, 6), scope: "household", householdId: HOUSEHOLD_ID }),
        action({ dueAt: new Date(2026, 6, 6), scope: "shared", householdId: HOUSEHOLD_ID }),
      ],
      NOW,
    );
    const twoHouseholds = selectActionSummaryItems(
      [
        action({ dueAt: new Date(2026, 6, 6), scope: "household", householdId: HOUSEHOLD_ID }),
        action({
          dueAt: new Date(2026, 6, 6),
          scope: "household",
          householdId: OTHER_HOUSEHOLD_ID,
        }),
      ],
      NOW,
    );

    for (const items of [withPrivate, withShared, twoHouseholds]) {
      expect(
        toActionSummaryArtifact({ ownerUserId: OWNER, localDate: LOCAL_DATE, items }),
      ).toMatchObject({ scope: "private", householdId: null });
    }
  });
});

/**
 * Wires the action summary workflow to a real (in-memory) delivery service, with a
 * caller-supplied set of the owner's own actions and an optional pre-configured Discord
 * target. Exercises the same #170 delivery matrix the relationship workflows ride.
 */
async function setupDeliveryHarness(options: {
  actions: GeneralAction[];
  target?: {
    targetId: string;
    targetScope?: "private" | "shared" | "household";
    targetHouseholdId?: string | null;
    allowPrivateSummary?: boolean;
  };
}) {
  const delivery = createScheduledWorkflowDeliveryService(
    createInMemoryScheduledWorkflowDeliveryStore(),
  );
  if (options.target) {
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: OWNER,
      workflow: "action_summary",
      enabled: true,
      targetId: options.target.targetId,
      allowSensitive: false,
      targetScope: options.target.targetScope,
      targetHouseholdId: options.target.targetHouseholdId,
      allowPrivateSummary: options.target.allowPrivateSummary,
    });
  }
  const workflow = createActionSummaryWorkflow({
    listOwnerActiveActions: vi.fn(async () => options.actions),
    deliverDiscordScheduledArtifact: (input) => delivery.deliverDiscordScheduledArtifact(input),
  });
  const sender = vi.fn(async () => undefined);
  return { workflow, sender };
}

describe("action summary scoped delivery", () => {
  it("delivers a purely household summary to a matching household Discord target", async () => {
    const { workflow, sender } = await setupDeliveryHarness({
      actions: [
        action({ dueAt: new Date(2026, 6, 6), scope: "household", householdId: HOUSEHOLD_ID }),
      ],
      target: {
        targetId: "discord-household",
        targetScope: "household",
        targetHouseholdId: HOUSEHOLD_ID,
      },
    });

    const result = await workflow.generateActionSummary({
      ownerUserId: OWNER,
      localDate: LOCAL_DATE,
      now: NOW,
      deliverDiscord: true,
      sender,
    });

    expect(result.artifact).toMatchObject({ scope: "household", householdId: HOUSEHOLD_ID });
    expect(result.delivery).toMatchObject({
      type: "sent",
      attempt: { artifactKind: "action_summary", status: "sent" },
    });
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ targetId: "discord-household" }));
  });

  it("never leaks a private action onto a shared/household target — fails closed", async () => {
    const { workflow, sender } = await setupDeliveryHarness({
      // One private action among household ones fails the whole summary closed.
      actions: [
        action({ dueAt: new Date(2026, 6, 6), scope: "household", householdId: HOUSEHOLD_ID }),
        action({ dueAt: new Date(2026, 6, 6), scope: "private" }),
      ],
      target: {
        targetId: "discord-household",
        targetScope: "household",
        targetHouseholdId: HOUSEHOLD_ID,
      },
    });

    const result = await workflow.generateActionSummary({
      ownerUserId: OWNER,
      localDate: LOCAL_DATE,
      now: NOW,
      deliverDiscord: true,
      sender,
    });

    expect(result.artifact).toMatchObject({ scope: "private", householdId: null });
    expect(result.delivery).toMatchObject({ type: "skipped", reason: "private_content_filtered" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("delivers a private summary to the owner's own private (owner-only) target", async () => {
    const { workflow, sender } = await setupDeliveryHarness({
      actions: [action({ dueAt: new Date(2026, 6, 6), scope: "private" })],
      target: { targetId: "discord-private", targetScope: "private" },
    });

    const result = await workflow.generateActionSummary({
      ownerUserId: OWNER,
      localDate: LOCAL_DATE,
      now: NOW,
      deliverDiscord: true,
      sender,
    });

    expect(result.delivery).toMatchObject({ type: "sent" });
    expect(sender).toHaveBeenCalledWith({
      targetId: "discord-private",
      content: "Tendnote action summary is ready for review: 1 action is ready for today.",
    });
  });

  it("does not deliver — or even attempt — an empty summary", async () => {
    const { workflow, sender } = await setupDeliveryHarness({
      // Only non-surfacing actions: nothing is on today.
      actions: [action({ dueAt: new Date(2026, 6, 20) }), action({})],
      target: { targetId: "discord-private", targetScope: "private" },
    });

    const result = await workflow.generateActionSummary({
      ownerUserId: OWNER,
      localDate: LOCAL_DATE,
      now: NOW,
      deliverDiscord: true,
      sender,
    });

    expect(result.items).toHaveLength(0);
    expect(result.delivery).toBeNull();
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("action summary scheduled dispatch (at most once per local day)", () => {
  const sender = vi.fn(async () => undefined);
  const result = {
    artifact: {},
    items: [],
    delivery: { type: "sent" },
  } as unknown as ActionSummaryWorkflowResult;

  function setup(attempts: { status: "sent" | "skipped" | "failed" }[]) {
    const generateActionSummary = vi.fn(async () => result);
    const listDeliveryAttemptsForArtifact = vi.fn(async () => attempts);
    const dispatch = createActionSummaryDispatch({
      generateActionSummary,
      listDeliveryAttemptsForArtifact,
    });
    return { dispatch, generateActionSummary, listDeliveryAttemptsForArtifact };
  }

  it("does nothing when no Discord target is wired — in-app review lives on Action Today", async () => {
    const { dispatch, generateActionSummary } = setup([]);
    await expect(
      dispatch.dispatchActionSummary({ ownerUserId: OWNER, now: NOW, timezone: "UTC" }),
    ).resolves.toBeNull();
    expect(generateActionSummary).not.toHaveBeenCalled();
  });

  it("delivers today's summary when nothing has been sent yet", async () => {
    const { dispatch, generateActionSummary, listDeliveryAttemptsForArtifact } = setup([]);

    const dispatched = await dispatch.dispatchActionSummary({
      ownerUserId: OWNER,
      now: NOW,
      timezone: "UTC",
      discordSender: sender,
    });

    expect(dispatched).toBe(result);
    expect(listDeliveryAttemptsForArtifact).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      artifactId: actionSummaryArtifactId("2026-07-06"),
    });
    expect(generateActionSummary).toHaveBeenCalledWith(
      expect.objectContaining({ localDate: "2026-07-06", deliverDiscord: true, sender }),
    );
  });

  it("skips a second run the same day once a summary has been sent (no nag loop)", async () => {
    const { dispatch, generateActionSummary } = setup([{ status: "sent" }]);

    await expect(
      dispatch.dispatchActionSummary({
        ownerUserId: OWNER,
        now: NOW,
        timezone: "UTC",
        discordSender: sender,
      }),
    ).resolves.toBeNull();
    expect(generateActionSummary).not.toHaveBeenCalled();
  });

  it("still delivers when the day's only prior attempts were skipped or failed", async () => {
    const { dispatch, generateActionSummary } = setup([
      { status: "skipped" },
      { status: "failed" },
    ]);

    await dispatch.dispatchActionSummary({
      ownerUserId: OWNER,
      now: NOW,
      timezone: "UTC",
      discordSender: sender,
    });
    expect(generateActionSummary).toHaveBeenCalledOnce();
  });
});

describe("action summary out-of-scope boundaries", () => {
  it("introduces no notification, reminder, or external-send system (out of scope)", () => {
    const source = readFileSync(join(process.cwd(), "src/queries/action-summary.ts"), "utf8");
    const importSources = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

    for (const moduleId of importSources) {
      // No push/email/SMS, notification center, or provider-side task/calendar writes.
      expect(moduleId).not.toMatch(/sendgrid|twilio|resend|nodemailer|firebase|apns|web-push/i);
      expect(moduleId).not.toMatch(/queries\/(gmail|drafts|calendar)/);
      expect(moduleId).not.toMatch(/notification/i);
    }
  });
});

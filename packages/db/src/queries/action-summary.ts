import type {
  ActionSurfacingReason,
  GeneralAction,
  ScheduledWorkflowDeliveryArtifact,
  ScheduledWorkflowDeliveryAttempt,
} from "@tendnote/domain";
import {
  ACTIVE_GENERAL_ACTION_STATUSES,
  aggregateArtifactScope,
  classifyActionSurfacing,
  formatLocalDate,
} from "@tendnote/domain";
import { createDrizzleGeneralActionLifecycleStore } from "./general-actions/drizzle-store";
import {
  createDefaultScheduledWorkflowDeliveryService,
  type DiscordProactiveDeliverySender,
  type DiscordScheduledArtifactDeliveryResult,
} from "./scheduled-workflow-deliveries";

export type { DiscordProactiveDeliverySender };

/**
 * One General Action selected into a scoped action summary, paired with *why* it
 * surfaced (ADR 0158). Only the disclosure- and label-relevant fields are carried:
 * `scope`/`householdId` feed the fail-closed scope aggregation, and `title` names the
 * item. Nothing owner-scoped beyond that reaches the artifact.
 */
export type ActionSummaryItem = {
  reason: ActionSurfacingReason;
  action: Pick<GeneralAction, "id" | "title" | "scope" | "householdId">;
};

/**
 * Selects the owner's due, overdue, and resurfaced Actions/Routines at instant `now`,
 * each tagged with its surfacing reason. The whole selection boundary is the shared
 * {@link classifyActionSurfacing} predicate, so an unscheduled someday action, a
 * future-dated one, a not-yet-arrived deferral, a paused Routine, and every terminal
 * action are all excluded here exactly as they are on the Action Today surface — the
 * summary and the view can never disagree about what is "on today" (ADRs 0149, 0157).
 *
 * Asset-linked actions (#203) need no branch here, and that is the design, not an
 * omission. An action proposed from an Asset Memory — a warranty check, a filter
 * replacement Routine — is an ordinary `general_actions` row once accepted; the asset
 * link lives in a side table and changes nothing about its timing, status, or scope.
 * So it becomes eligible for this summary by being *due*, exactly like every other
 * action, and a still-`suggested` proposal is excluded by the same status gate that
 * excludes every other proposal. Phase 6 adds no asset-aware selection rule, and must
 * never need one: the moment asset actions require special surfacing, Tendnote has
 * grown the standalone asset notification system #196 explicitly forbids.
 */
export function selectActionSummaryItems(
  actions: ReadonlyArray<GeneralAction>,
  now: Date,
): ActionSummaryItem[] {
  const items: ActionSummaryItem[] = [];
  for (const action of actions) {
    const reason = classifyActionSurfacing(action, now);
    if (reason) {
      items.push({
        reason,
        action: {
          id: action.id,
          title: action.title,
          scope: action.scope,
          householdId: action.householdId,
        },
      });
    }
  }
  return items;
}

/**
 * The deterministic per-day artifact id for an owner's action summary. The summary
 * references persisted, in-app-reviewable Actions rather than a freshly stored artifact
 * row, so this local-day key is what keeps the delivery-attempt ledger traceable and
 * lets the dispatcher deliver at most once per day (no new table). One source of truth
 * so the builder and the dispatcher's dedup can't drift.
 */
export function actionSummaryArtifactId(localDate: string): string {
  return `action_summary:${localDate}`;
}

/**
 * Builds the scoped delivery artifact for an action summary. Its disclosure scope is
 * aggregated from the items via the least-shareable-item rule (ADR 0142): the summary
 * carries `household` scope only when every surfacing action is household-visible for
 * one household, and fails closed to `private` the moment any private or
 * selected-shared action is included — so a private or selected-member Action can
 * never widen the summary onto a shared Discord channel.
 *
 * Sensitivity is always `normal`. This is safe not merely because General Actions carry
 * no sensitivity classification in Phase 5, but because the delivered payload is
 * COUNT-ONLY — {@link actionSummaryText} emits just a number ("3 actions are ready for
 * today."), never an action's title, notes, or any content. If a future change ever
 * puts item text into the summary, this `normal` assumption must be revisited: titles
 * can carry sensitive material, and the sensitivity gate (evaluated before scope) would
 * then need a real per-item max rather than a constant.
 */
export function toActionSummaryArtifact(input: {
  ownerUserId: string;
  localDate: string;
  items: ReadonlyArray<ActionSummaryItem>;
}): ScheduledWorkflowDeliveryArtifact {
  const { scope, householdId } = aggregateArtifactScope(
    input.items.map(({ action }) => ({ scope: action.scope, householdId: action.householdId })),
  );
  return {
    ownerUserId: input.ownerUserId,
    workflow: "action_summary",
    artifactKind: "action_summary",
    artifactId: actionSummaryArtifactId(input.localDate),
    sensitivity: "normal",
    scope,
    householdId,
    persisted: true,
    summary: actionSummaryText(input.items.length),
  };
}

/** A calm, count-only summary line — no pressure, no per-item disclosure, no red. */
function actionSummaryText(itemCount: number): string {
  if (itemCount === 1) {
    return "1 action is ready for today.";
  }
  return `${itemCount} actions are ready for today.`;
}

export type GenerateActionSummaryInput = {
  ownerUserId: string;
  /** The owner's local calendar day, keying the summary's deterministic artifact id. */
  localDate: string;
  now?: Date;
  deliverDiscord?: boolean;
  sender?: DiscordProactiveDeliverySender;
};

export type ActionSummaryWorkflowResult = {
  artifact: ScheduledWorkflowDeliveryArtifact;
  items: ActionSummaryItem[];
  delivery: DiscordScheduledArtifactDeliveryResult | null;
};

export type ActionSummaryWorkflowDeps = {
  /** Lists the owner's own active (open/deferred) Actions — never co-members' shared ones. */
  listOwnerActiveActions: (input: { ownerUserId: string }) => Promise<GeneralAction[]>;
  deliverDiscordScheduledArtifact?: (input: {
    artifact: ScheduledWorkflowDeliveryArtifact;
    sender: DiscordProactiveDeliverySender;
  }) => Promise<DiscordScheduledArtifactDeliveryResult>;
};

/**
 * The scoped action summary workflow (ADR 0158): gather the owner's own surfacing
 * Actions, aggregate their disclosure scope, and — only when opted in and only when
 * something actually surfaces — deliver a summary-only nudge through the shared Phase 4
 * delivery service, which gates it against the configured target's scope and never
 * leaks a private or selected-member Action. The summary is built over the owner's
 * *own* actions so a co-member's shared Action never appears in someone else's Discord
 * summary; the Action Today surface, by contrast, shows every action the caller may see.
 */
export function createActionSummaryWorkflow(deps: ActionSummaryWorkflowDeps) {
  return {
    async generateActionSummary(
      input: GenerateActionSummaryInput,
    ): Promise<ActionSummaryWorkflowResult> {
      const now = input.now ?? new Date();
      const actions = await deps.listOwnerActiveActions({ ownerUserId: input.ownerUserId });
      const items = selectActionSummaryItems(actions, now);
      const artifact = toActionSummaryArtifact({
        ownerUserId: input.ownerUserId,
        localDate: input.localDate,
        items,
      });

      // An empty summary is never delivered: a proactive "nothing is due" message is a
      // nag, and this is the register's most guilt-prone surface. The artifact is still
      // returned so a caller can render the in-app Action Today view (ADRs 0157, 0162).
      const delivery =
        input.deliverDiscord === true &&
        input.sender &&
        deps.deliverDiscordScheduledArtifact &&
        items.length > 0
          ? await deps.deliverDiscordScheduledArtifact({ artifact, sender: input.sender })
          : null;

      return { artifact, items, delivery };
    },
  };
}

const defaultDeliveryService = createDefaultScheduledWorkflowDeliveryService();

const defaultGeneralActionStore = createDrizzleGeneralActionLifecycleStore();

const defaultActionSummaryWorkflow = createActionSummaryWorkflow({
  listOwnerActiveActions: ({ ownerUserId }) =>
    defaultGeneralActionStore.listGeneralActionsForOwner({
      ownerUserId,
      statuses: [...ACTIVE_GENERAL_ACTION_STATUSES],
    }),
  deliverDiscordScheduledArtifact: (input) =>
    defaultDeliveryService.deliverDiscordScheduledArtifact(input),
});

export function generateActionSummary(input: GenerateActionSummaryInput) {
  return defaultActionSummaryWorkflow.generateActionSummary(input);
}

export type DispatchActionSummaryInput = {
  ownerUserId: string;
  now?: Date;
  timezone?: string;
  discordSender?: DiscordProactiveDeliverySender;
};

export type ActionSummaryDispatchDeps = {
  generateActionSummary: (
    input: GenerateActionSummaryInput,
  ) => Promise<ActionSummaryWorkflowResult>;
  /** Reads the delivery-attempt ledger for one artifact id, for the once-per-day gate. */
  listDeliveryAttemptsForArtifact: (input: {
    ownerUserId: string;
    artifactId: string;
  }) => Promise<Pick<ScheduledWorkflowDeliveryAttempt, "status">[]>;
};

/**
 * The scheduled dispatcher for the scoped action summary, wired into the app-owned brief
 * dispatcher (issue #186). On each cron tick it delivers the owner's summary — but at
 * most once per local day. A proactive daily summary is NOT a 15-minute nag loop (ADR
 * 0162), so before generating it checks the delivery-attempt ledger for today's per-day
 * artifact id and does nothing if a summary already went out. The first tick of the day
 * with something on today delivers (and `generateActionSummary` still self-suppresses an
 * empty summary); every later tick that day finds the `sent` attempt and skips. In-app
 * review lives on the Action Today surface, so a run without a configured Discord target
 * is a no-op here.
 */
export function createActionSummaryDispatch(deps: ActionSummaryDispatchDeps) {
  return {
    async dispatchActionSummary(
      input: DispatchActionSummaryInput,
    ): Promise<ActionSummaryWorkflowResult | null> {
      if (!input.discordSender) {
        return null;
      }

      const now = input.now ?? new Date();
      const timezone = input.timezone ?? "UTC";
      const localDate = formatLocalDate(timezone, now);

      const attempts = await deps.listDeliveryAttemptsForArtifact({
        ownerUserId: input.ownerUserId,
        artifactId: actionSummaryArtifactId(localDate),
      });
      if (attempts.some((attempt) => attempt.status === "sent")) {
        return null;
      }

      return deps.generateActionSummary({
        ownerUserId: input.ownerUserId,
        localDate,
        now,
        deliverDiscord: true,
        sender: input.discordSender,
      });
    },
  };
}

const defaultActionSummaryDispatch = createActionSummaryDispatch({
  generateActionSummary: (input) => defaultActionSummaryWorkflow.generateActionSummary(input),
  listDeliveryAttemptsForArtifact: (input) =>
    defaultDeliveryService.listDeliveryAttemptsForArtifact(input),
});

export function dispatchActionSummary(input: DispatchActionSummaryInput) {
  return defaultActionSummaryDispatch.dispatchActionSummary(input);
}

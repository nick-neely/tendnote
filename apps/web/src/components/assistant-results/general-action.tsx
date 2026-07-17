import {
  assistantToolResultSchemas,
  type GeneralActionRefOutput,
  type GeneralActionStatus,
  isReviewGeneralActionStatus,
  type SuggestedGeneralActionReviewItemOutput,
} from "@tendnote/domain";
import { ArrowUpRightIcon, ListTodoIcon, RepeatIcon } from "lucide-react";
import Link from "next/link";
import { Body, Caption, ResultCard } from "@/components/assistant-result-card";
import { formatLinkedPeople, joinGeneralActionMeta } from "@/lib/eve/general-action-meta";
import type {
  GeneralActionListItemView,
  SuggestedGeneralActionReviewItemView,
} from "@/lib/eve/tool-result-view";
import { defineModule } from "./module";
import { flagIsFalse, formatDueLabel } from "./shared";
import { DisclosureShell, ToolActivityLine } from "./shells";

/**
 * General Action result modules (#227). Active General Actions stay distinct from
 * Suggested General Actions awaiting review; an Asset-derived proposal pass is an
 * ordinary Suggested General Action that never bypasses review (its parser lives on
 * the suggested-review-list module). Projection, trust treatment, and rendering are
 * local so no caller re-derives a ledger row's surfacing cue or its trust chip.
 */

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/**
 * The calm surfacing cue for a General Action, mirroring the /actions ledger: a
 * paused Routine reads as set aside, a deferred one as "Set aside until …", a dated
 * one by its due date, and an undated one carries no cue.
 */
function formatGeneralActionTiming(action: GeneralActionRefOutput): string | null {
  if (action.status === "paused") {
    return "Paused";
  }
  if (action.status === "deferred" && action.deferUntil) {
    return `Set aside until ${formatDueLabel(action.deferUntil)}`;
  }
  if (action.dueAt) {
    return `Due ${formatDueLabel(action.dueAt)}`;
  }
  return null;
}

/** Whether a ledger row is a review-status proposal rather than a committed action. */
function isGeneralActionReviewStatus(status: string): boolean {
  return isReviewGeneralActionStatus(status as GeneralActionStatus);
}

function toGeneralActionListItem(action: GeneralActionRefOutput): GeneralActionListItemView {
  return {
    generalActionId: action.id,
    title: action.title,
    status: action.status,
    isRoutine: action.isRoutine,
    recurrenceLabel: action.recurrence,
    timingLabel: formatGeneralActionTiming(action),
    personNames: action.people.map((person) => person.displayName),
    visibilityLabel: action.visibilityLabel,
  };
}

function toSuggestedGeneralActionReviewItem(
  parsed: SuggestedGeneralActionReviewItemOutput,
): SuggestedGeneralActionReviewItemView {
  const { action } = parsed;
  return {
    generalActionId: action.id,
    title: action.title,
    status: action.status,
    dueLabel: action.dueAt ? formatDueLabel(action.dueAt) : null,
    isRoutine: action.isRoutine,
    recurrenceLabel: action.recurrence,
    personNames: action.people.map((person) => person.displayName),
    visibilityLabel: action.visibilityLabel,
  };
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

/**
 * The calm caption under a created action or ledger row: cadence, timing, linked
 * people, and visibility, joined with dots and any empty part dropped.
 */
function summarizeGeneralAction(
  action: Pick<
    GeneralActionListItemView,
    "isRoutine" | "recurrenceLabel" | "timingLabel" | "personNames" | "visibilityLabel"
  >,
): string | null {
  return joinGeneralActionMeta([
    action.isRoutine ? (action.recurrenceLabel ?? "Routine") : action.timingLabel,
    formatLinkedPeople(action.personNames),
    action.visibilityLabel,
  ]);
}

/**
 * Humanized status words for a ledger row's chip (the store's raw enum stays
 * hidden). A lookup rather than a branch: an unknown status is passed through
 * verbatim, so a new store enum degrades to its raw word instead of throwing.
 */
const GENERAL_ACTION_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  deferred: "Set aside",
  completed: "Done",
  dismissed: "Dismissed",
  archived: "Archived",
  paused: "Paused",
  suggested: "Suggested",
  ignored: "Ignored",
};

function labelGeneralActionStatus(status: string): string {
  return GENERAL_ACTION_STATUS_LABELS[status] ?? status;
}

/** The quiet empty-state line for a ledger read that came back with nothing. */
function labelEmptyGeneralActionList(ledger: string): string {
  switch (ledger) {
    case "paused":
      return "No paused routines";
    case "resolved":
      return "Nothing finished recently";
    default:
      return "Nothing on your active list";
  }
}

/** One General Action in a ledger list: title, a status chip, and a calm summary line. */
function GeneralActionRow({ action }: { action: GeneralActionListItemView }) {
  const summary = summarizeGeneralAction(action);
  return (
    <div className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {action.isRoutine ? (
            <RepeatIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ListTodoIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium text-foreground">{action.title}</span>
        </span>
        <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[length:var(--text-caption)] text-muted-foreground">
          {labelGeneralActionStatus(action.status)}
        </span>
      </div>
      {summary ? <Caption>{summary}</Caption> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

/** A committed General Action: a confirmed card that deep-links its exact ledger row. */
export const createdGeneralActionModule = defineModule<"created_general_action">({
  kind: "created_general_action",
  parsers: {
    create_general_action: (output) => {
      const parsed = assistantToolResultSchemas.create_general_action.safeParse(output);
      if (!parsed.success) return null;
      return { kind: "created_general_action", ...toGeneralActionListItem(parsed.data.action) };
    },
  },
  tier: () => "card",
  key: (view) => `general-action:${view.generalActionId}`,
  render: (view, isNew) => {
    const summary = summarizeGeneralAction(view);
    return (
      <ResultCard
        footer={
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {summary ? <Caption>{summary}</Caption> : <span />}
            <Link
              className="inline-flex items-center gap-0.5 text-[length:var(--text-caption)] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              href={`/actions#action-${view.generalActionId}`}
            >
              Open in Actions
              <ArrowUpRightIcon aria-hidden className="size-3" />
            </Link>
          </div>
        }
        icon={
          view.isRoutine ? <RepeatIcon className="size-3" /> : <ListTodoIcon className="size-3" />
        }
        isNew={isNew}
        kind={view.kind}
        label={view.isRoutine ? "Added a routine" : "Added to your actions"}
        tone="confirmed"
      >
        <Body>{view.title}</Body>
      </ResultCard>
    );
  },
});

/** Tentative Suggested General Action — routed to the interactive review card. */
export const suggestedGeneralActionReviewModule = defineModule<"suggested_general_action_review">({
  kind: "suggested_general_action_review",
  parsers: {
    suggest_general_action: (output) => {
      const parsed = assistantToolResultSchemas.suggest_general_action.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "suggested_general_action_review",
        ...toSuggestedGeneralActionReviewItem(parsed.data),
      };
    },
    get_suggested_general_action_review: (output) => {
      const parsed =
        assistantToolResultSchemas.get_suggested_general_action_review.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "suggested_general_action_review",
        ...toSuggestedGeneralActionReviewItem(parsed.data),
      };
    },
  },
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "found"),
    note: "No suggested action to review",
  },
  tier: () => "card",
  key: (view) => `suggested-general-action:${view.generalActionId}`,
  interactive: true,
});

/**
 * A batch of Suggested General Actions for review — the shallow plan, an
 * Asset-derived proposal pass, and the ledger's review list all render as the same
 * review cards. An Asset-derived proposal IS a Suggested General Action, so it never
 * gets an asset-specific card that could bypass review (#203).
 */
export const suggestedGeneralActionReviewListModule =
  defineModule<"suggested_general_action_review_list">({
    kind: "suggested_general_action_review_list",
    parsers: {
      plan_suggested_general_actions: (output) => {
        const parsed = assistantToolResultSchemas.plan_suggested_general_actions.safeParse(output);
        if (!parsed.success) return null;
        return {
          kind: "suggested_general_action_review_list",
          reviews: parsed.data.proposed.map(toSuggestedGeneralActionReviewItem),
        };
      },
      propose_asset_actions: (output) => {
        const parsed = assistantToolResultSchemas.propose_asset_actions.safeParse(output);
        if (!parsed.success) return null;
        return {
          kind: "suggested_general_action_review_list",
          reviews: parsed.data.proposed.map(toSuggestedGeneralActionReviewItem),
        };
      },
      list_suggested_general_action_reviews: (output) => {
        const parsed =
          assistantToolResultSchemas.list_suggested_general_action_reviews.safeParse(output);
        if (!parsed.success) return null;
        return {
          kind: "suggested_general_action_review_list",
          reviews: parsed.data.reviews.map(toSuggestedGeneralActionReviewItem),
        };
      },
    },
    negativeOutcome: {
      matches: (output) => flagIsFalse(output, "found"),
      note: "No actions to review",
    },
    tier: () => "card",
    key: (view) =>
      `suggested-general-action-list:${view.reviews
        .map((review) => review.generalActionId)
        .join(":")}`,
    interactive: true,
  });

/** The committed General Action ledger as an expandable list; tentative rows are dropped. */
export const generalActionListModule = defineModule<"general_action_list">({
  kind: "general_action_list",
  parsers: {
    list_general_actions: (output) => {
      const parsed = assistantToolResultSchemas.list_general_actions.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "general_action_list",
        ledger: parsed.data.ledger,
        window: parsed.data.window ?? null,
        // Drop any review-status row so a tentative `suggested`/`ignored` proposal —
        // which carries no accept/dismiss affordance here — can never masquerade as
        // a committed action.
        actions: parsed.data.actions
          .filter((action) => !isGeneralActionReviewStatus(action.status))
          .map(toGeneralActionListItem),
      };
    },
  },
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "found"),
    note: "Nothing on your list",
  },
  tier: (view) => (view.actions.length > 0 ? "disclosure" : "line"),
  key: (view) =>
    `general-action-list:${view.actions.map((action) => action.generalActionId).join(":")}`,
  render: (view, isNew) => {
    if (view.actions.length === 0) {
      return (
        <ToolActivityLine icon={<ListTodoIcon aria-hidden className="size-3.5" />} isNew={isNew}>
          {labelEmptyGeneralActionList(view.ledger)}
        </ToolActivityLine>
      );
    }
    const count = view.actions.length;
    return (
      <DisclosureShell
        icon={<ListTodoIcon aria-hidden className="size-3.5 shrink-0" />}
        isNew={isNew}
        summary={count === 1 ? "1 action" : `${count} actions`}
        toolView={view.kind}
      >
        <div className="flex flex-col divide-y divide-border/70 border-t px-3.5 pt-3 pb-3.5">
          {view.actions.map((action) => (
            <GeneralActionRow action={action} key={action.generalActionId} />
          ))}
        </div>
      </DisclosureShell>
    );
  },
});

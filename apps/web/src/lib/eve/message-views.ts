import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
  UseEveAgentStatus,
} from "eve/react";
// This lib→components import is deliberate: message-views is the chat view-model glue
// that turns Eve message parts into renderable turn units, and the result-module
// registry is the single source for projection and grouping. Co-locating each kind's
// projection with its (JSX) rendering is the whole point of the registry, so the
// projection dispatcher necessarily lives in the component layer; this module is only
// used by the client assistant panel, so the direction costs nothing.
import {
  type GroupableToolKind,
  isGroupableToolKind,
  resultViewSummary,
  toAssistantToolView,
  toolViewTier,
} from "@/components/assistant-results/registry";
import { activeToolLabel, completedToolLabel } from "./active-tool-label";
import {
  type AssistantInputRequestView,
  type AssistantInputResolutionView,
  toInputRequestView,
  toInputResolutionView,
} from "./input-request-view";
import type { AssistantToolView } from "./tool-result-view";

function isTextPart(part: EveMessagePart): part is Extract<EveMessagePart, { type: "text" }> {
  return part.type === "text";
}

/**
 * Tools the model calls to steer the interface rather than to do anything the
 * reader asked for. Their whole output is chrome — `suggest_next_steps` is the
 * follow-up chips and nothing else — so surfacing the call as an activity step, a
 * result card, or a line would narrate the app talking to itself. They are
 * filtered at the projection seam rather than at each renderer, so a silent tool
 * is silent everywhere by construction.
 */
const SILENT_TOOL_NAMES: ReadonlySet<string> = new Set(["suggest_next_steps"]);

/** The tool whose result the model uses to propose the turn's follow-up chips. */
const SUGGEST_NEXT_STEPS_TOOL = "suggest_next_steps";

function isRenderedToolPart(part: EveMessagePart): boolean {
  return part.type !== "dynamic-tool" || !SILENT_TOOL_NAMES.has(part.toolName);
}

/** Only terminal `output-available` tool parts carry a persisted payload. */
function isCompletedToolPart(
  part: EveMessagePart,
): part is EveDynamicToolPart & { state: "output-available"; output: unknown } {
  return part.type === "dynamic-tool" && part.state === "output-available";
}

/** A tool call still running — no persisted output yet (the working line). */
function isActiveToolPart(
  part: EveMessagePart,
): part is EveDynamicToolPart & { state: "input-streaming" | "input-available" } {
  return (
    part.type === "dynamic-tool" &&
    (part.state === "input-streaming" || part.state === "input-available")
  );
}

/**
 * One renderable tool result plus the call that produced it. `toolCallId` is the
 * reducer's own per-call identity (`dynamic-tool:${toolCallId}`), so it is unique
 * even when a turn calls the same tool more than once — the React key must use it
 * rather than the tool name, which collides across repeated calls.
 */
export type AssistantToolEntry = {
  readonly toolCallId: string;
  /**
   * The tool that produced the result. The projected view deliberately forgets
   * it — a `saved_memory` card is about the memory, not about `capture_memory` —
   * but the activity disclosure still has to *name* the call in past tense, and
   * only the call knows which tool it was.
   */
  readonly toolName: string;
  readonly view: AssistantToolView;
};

/** Streamed assistant text for one message, concatenated across its text parts. */
export function messageText(message: EveMessage): string {
  return message.parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join("");
}

/** One thing Eve said in a turn, with the reducer's own part identity as a key. */
export type AssistantTextSegment = {
  readonly key: string;
  readonly text: string;
};

/**
 * The assistant's text for one message, kept as the separate utterances it was
 * actually spoken in. Eve emits one text part per agent step, so a turn that
 * pauses to run tools comes back as several segments ("I'll look up what you
 * know about Jordan Rivera." / "Found them." / "Here's what you have."). They
 * are distinct paragraphs, not one sentence, so the view renders each as its own
 * block instead of running them together - the separation is layout, never
 * characters spliced into the streamed text.
 */
export function messageTextSegments(message: EveMessage): AssistantTextSegment[] {
  return message.parts
    .filter(isTextPart)
    .map((part, index) => ({
      key: `text:${part.stepIndex ?? index}`,
      text: part.text.trim(),
    }))
    .filter((segment) => segment.text.length > 0);
}

/**
 * Renderable views for an assistant message's persisted tool results. Only
 * terminal `output-available` parts on an assistant message carry a persisted
 * payload; pending, errored, denied, or non-assistant parts are skipped so the
 * UI never implies an unsaved result (ADR 0028, ADR 0029).
 */
export function messageToolViews(message: EveMessage): AssistantToolEntry[] {
  if (message.role !== "assistant") {
    return [];
  }

  return message.parts
    .filter(isRenderedToolPart)
    .filter(isCompletedToolPart)
    .map((part) => ({
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      view: toAssistantToolView({ toolName: part.toolName, output: part.output }),
    }));
}

/**
 * The follow-up prompts the model itself proposed for this turn, or `null` when
 * it proposed none.
 *
 * The distinction matters: `null` means the tool never ran, and the app falls
 * back to what it can derive from the turn's results; an *empty* array means the
 * model looked at its own answer and decided there was no useful next step, which
 * is an answer, not an absence. Only the last call counts — a turn that revised
 * its mind mid-stream meant the revision.
 */
export function messageProposedFollowUps(message: EveMessage): readonly string[] | null {
  if (message.role !== "assistant") {
    return null;
  }

  let proposed: readonly string[] | null = null;
  for (const part of message.parts) {
    if (
      part.type !== "dynamic-tool" ||
      part.toolName !== SUGGEST_NEXT_STEPS_TOOL ||
      part.state !== "output-available"
    ) {
      continue;
    }
    const output = part.output;
    if (typeof output !== "object" || output === null) {
      continue;
    }
    const suggestions = (output as { suggestions?: unknown }).suggestions;
    if (Array.isArray(suggestions)) {
      proposed = suggestions.filter((item): item is string => typeof item === "string");
    }
  }
  return proposed;
}

/** One in-flight tool call, surfaced as a transient "working" shimmer line. */
export type AssistantActiveTool = {
  readonly specialist?: string;
  readonly toolCallId: string;
  readonly label: string;
};

/**
 * Whether Eve is still working: `submitted` (the turn is sent, no events yet),
 * `resuming` (reattaching to a turn that is already running server-side), and
 * `streaming` (events arriving) are the live states. `ready` and `error` are
 * both verdicts on a turn that is over - one settled, one failed - and neither
 * leaves anything running.
 */
export function isTurnInFlight(status: UseEveAgentStatus): boolean {
  return status === "submitted" || status === "resuming" || status === "streaming";
}

/**
 * In-flight tool calls on an assistant message. These carry no persisted output
 * yet, so the UI shows them as ephemeral shimmer activity ("Searching people…")
 * that is replaced by the real view once the call reaches `output-available`
 * (see {@link messageToolViews}). Pending approval, error, denied, and
 * non-assistant parts are skipped (ADR 0028, ADR 0029).
 *
 * `turnInFlight` is what keeps a working line from outliving the work. A tool
 * part does not reliably walk itself to a terminal state: a turn can finish, or
 * fail, or be dropped mid-stream with a call still parked in `input-available`,
 * and that part alone will happily claim forever that Eve is searching people.
 * Activity is a property of the turn, not of a leftover part, so the caller
 * passes {@link isTurnInFlight} for the live turn and `false` for every settled
 * one - once the turn is over, nothing is in flight by definition.
 */
export function messageActiveToolViews(
  message: EveMessage,
  turnInFlight: boolean,
): AssistantActiveTool[] {
  if (message.role !== "assistant" || !turnInFlight) {
    return [];
  }

  return message.parts
    .filter(isRenderedToolPart)
    .filter(isActiveToolPart)
    .map((part) => ({
      toolCallId: part.toolCallId,
      label: activeToolLabel(part.toolName),
      ...(part.toolName.startsWith("subagent:") ? { specialist: part.toolName.slice(9) } : {}),
    }));
}

/**
 * One renderable item in a turn's tool activity: either a standalone result or a
 * collapsed group of same-kind durable records. When a single turn produces many
 * of the same durable record — the common "added a person, then saved six things
 * about them" turn — rendering each as its own card buries the conversation. We
 * fold runs of the same {@link GroupableToolKind} into one collapsible summary so
 * the turn reads as "Saved 6 memories" by default and expands on demand, while a
 * lone result still renders as its own card (see AssistantToolGroup).
 */
export type AssistantTurnUnit =
  | { readonly type: "single"; readonly entry: AssistantToolEntry }
  | {
      readonly type: "group";
      readonly kind: GroupableToolKind;
      readonly entries: readonly [AssistantToolEntry, ...AssistantToolEntry[]];
    }
  /** A call parked on the owner: the approval (or question) card they act on. */
  | { readonly type: "request"; readonly request: AssistantInputRequestView }
  /** Several tool approvals parked in one breath: one card listing all of them. */
  | {
      readonly type: "request-batch";
      readonly requests: readonly [
        AssistantInputRequestView,
        AssistantInputRequestView,
        ...AssistantInputRequestView[],
      ];
    }
  /** A parked call that has settled: a quiet status in the slot the card held. */
  | { readonly type: "resolution"; readonly resolution: AssistantInputResolutionView }
  /** A call still running: the transient working shimmer. */
  | { readonly type: "active"; readonly active: AssistantActiveTool };

/**
 * The two units a turn's *persisted results* fold into. Kept separate from the
 * full {@link AssistantTurnUnit} union so {@link groupTurnToolEntries} stays a
 * statement about results only — grouping has nothing to say about a parked
 * request or a working line, and its callers should not have to prove that.
 */
export type AssistantToolUnit = Extract<AssistantTurnUnit, { type: "group" | "single" }>;

/**
 * Every unit that renders as a card in the turn — i.e. all of them except the
 * transient working line, which is panel chrome the composer's own "Thinking…"
 * shimmer shares rather than a tool-result card. Splitting it out at the type level
 * is what keeps the card registry exhaustive over exactly the cards.
 */
export type AssistantTurnCardUnit = Exclude<AssistantTurnUnit, { type: "active" }>;

type PendingGroup = {
  kind: GroupableToolKind;
  entries: [AssistantToolEntry, ...AssistantToolEntry[]];
};

function isPendingGroup(
  slot: { type: "single"; entry: AssistantToolEntry } | PendingGroup,
): slot is PendingGroup {
  return "entries" in slot;
}

/**
 * Folds a turn's tool entries into render units, collapsing same-kind durable
 * records into groups while leaving everything else (lookups, disclosures, and
 * the interactive review cards) untouched and in place. A group keeps the slot of
 * its first member so ordering stays faithful to the turn even when records of a
 * kind are interleaved, and a kind that occurs only once degrades back to a single
 * so a solitary save still earns its full card.
 */
export function groupTurnToolEntries(entries: readonly AssistantToolEntry[]): AssistantToolUnit[] {
  const slots: ({ type: "single"; entry: AssistantToolEntry } | PendingGroup)[] = [];
  const pendingByKind = new Map<GroupableToolKind, PendingGroup>();

  for (const entry of entries) {
    const { kind } = entry.view;
    if (isGroupableToolKind(kind)) {
      const open = pendingByKind.get(kind);
      if (open) {
        open.entries.push(entry);
      } else {
        const group: PendingGroup = { kind, entries: [entry] };
        pendingByKind.set(kind, group);
        slots.push(group);
      }
    } else {
      slots.push({ type: "single", entry });
    }
  }

  return slots.map((slot): AssistantToolUnit => {
    if (!isPendingGroup(slot)) {
      return slot;
    }
    const [first, ...rest] = slot.entries;
    return rest.length > 0
      ? { type: "group", kind: slot.kind, entries: slot.entries }
      : { type: "single", entry: first };
  });
}

/**
 * Everything one assistant turn did with tools, in the order it happened.
 *
 * Part order *is* turn order, and the default reducer keys a tool part by its call
 * id, so each call contributes exactly one unit here: the working shimmer while it
 * runs, the approval card while it waits on the owner, the settled status once it is
 * answered or refused, and the result card once it produces one. That is what keeps a
 * parked call in the seat its tool call occupies instead of floating to the bottom of
 * the turn, and what makes a shimmer and a card for the same call impossible.
 *
 * Same-kind durable saves still fold into one collapsed group
 * ({@link groupTurnToolEntries}), which then takes the slot of its first member so a
 * busy capture turn reads as a short summary without reordering the turn around it.
 *
 * Tool approvals fold the same way and for the same reason: a turn that parked three
 * calls parked them in one `input.requested`, and three stacked cards is how an
 * interruption becomes unreadable. They render as one `request-batch` in the slot of
 * the first, and a turn with a single parked call still projects a plain `request`.
 * Answered ones drop out as their own settled units, in the seats they occupied.
 *
 * `turnInFlight` gates only the working lines: a call parked in `input-available`
 * when a turn ends would otherwise claim forever that Eve is still searching (see
 * {@link messageActiveToolViews}). A parked approval is *not* activity — the turn is
 * durably waiting on a person, so its card outlives the stream.
 */
export function messageTurnUnits(message: EveMessage, turnInFlight: boolean): AssistantTurnUnit[] {
  if (message.role !== "assistant") {
    return [];
  }

  const placed: { at: number; unit: AssistantTurnUnit }[] = [];
  const results: { at: number; entry: AssistantToolEntry }[] = [];
  /** Tool approvals still waiting on the owner, in the order the turn parked them. */
  const parked: { at: number; request: AssistantInputRequestView }[] = [];

  message.parts.forEach((part, at) => {
    // A silent tool contributes no unit in any state: not a working line while it
    // runs, not a card when it lands.
    if (part.type !== "dynamic-tool" || !isRenderedToolPart(part)) {
      return;
    }

    if (isCompletedToolPart(part)) {
      results.push({
        at,
        entry: {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          view: toAssistantToolView({ toolName: part.toolName, output: part.output }),
        },
      });
      return;
    }

    const request = toInputRequestView(part);
    if (request) {
      // A question is the model's own words to one person and is never batched with
      // anything; a tool approval waits to see whether it has siblings.
      if (request.kind === "tool-approval") {
        parked.push({ at, request });
      } else {
        placed.push({ at, unit: { type: "request", request } });
      }
      return;
    }

    const resolution = toInputResolutionView(part);
    if (resolution) {
      placed.push({ at, unit: { type: "resolution", resolution } });
      return;
    }

    if (turnInFlight && isActiveToolPart(part)) {
      placed.push({
        at,
        unit: {
          type: "active",
          active: {
            toolCallId: part.toolCallId,
            label: activeToolLabel(part.toolName),
            ...(part.toolName.startsWith("subagent:")
              ? { specialist: part.toolName.slice(9) }
              : {}),
          },
        },
      });
    }
  });

  // Every approval still parked in this turn came from one `input.requested`: eve
  // holds the turn while any of them wait, so no later step can have parked another.
  // Two or more become one card in the slot of the first, and a lone one keeps
  // exactly the card it has always had.
  const head = parked[0];
  const second = parked[1];
  if (head && second) {
    placed.push({
      at: head.at,
      unit: {
        type: "request-batch",
        requests: [head.request, second.request, ...parked.slice(2).map((it) => it.request)],
      },
    });
  } else if (head) {
    placed.push({ at: head.at, unit: { type: "request", request: head.request } });
  }

  const slotOf = new Map(results.map(({ at, entry }) => [entry.toolCallId, at]));
  for (const unit of groupTurnToolEntries(results.map(({ entry }) => entry))) {
    const first = unit.type === "group" ? unit.entries[0] : unit.entry;
    placed.push({ at: slotOf.get(first.toolCallId) ?? 0, unit });
  }

  return placed.sort((a, b) => a.at - b.at).map(({ unit }) => unit);
}

// ---------------------------------------------------------------------------
// Turn anatomy (activity vs answer vs cards)
// ---------------------------------------------------------------------------

/**
 * The turn's thinking, consolidated. Eve buffers one reasoning block per agent
 * step, so a turn that stopped twice to run tools arrives as several parts; the
 * disclosure shows one continuous account of the turn rather than three folds
 * the reader has to open in sequence. `streaming` is true while any block is
 * still being written — that is what keeps the trigger saying "Working…".
 */
export type AssistantTurnReasoning = {
  readonly text: string;
  readonly streaming: boolean;
};

/** One tool call as the activity disclosure lists it. */
export type AssistantActivityStep = {
  readonly specialist?: string;
  readonly toolCallId: string;
  /** Present-continuous while it runs, past tense once it settled. */
  readonly label: string;
  /** The result module's one-line summary, when the kind has something to add. */
  readonly description: string | null;
  readonly status: "active" | "complete";
};

/** A file attached to a message, with the url eve resolved for it. */
export type AssistantFilePart = Extract<EveMessagePart, { type: "file" }>;

/**
 * One assistant turn, split into the four things that render in order: what it
 * was doing, what it said, what it produced, and what it needs the owner to
 * authorize.
 *
 * The split is the whole point of the anatomy. Before it, a turn's ambient
 * lookups ("Searched people") trailed *underneath* the answer, so the last thing
 * a reader saw was housekeeping rather than the reply. Now the same lookups sit
 * in the collapsible activity block above the answer, and only results that
 * carry durable state — cards, disclosures, review affordances, parked approvals
 * — stay below it as the payload.
 *
 * The partition is by presentational tier, not by a hand-kept list: a `line` is
 * by definition a result that recedes, so it belongs to the activity, and a
 * `card`/`disclosure` is by definition something the reader has to notice. A
 * group is always a run of durable saves, so it is always payload.
 */
export type AssistantTurnAnatomy = {
  readonly reasoning: AssistantTurnReasoning | null;
  readonly activity: readonly AssistantActivityStep[];
  readonly cards: readonly AssistantTurnCardUnit[];
  readonly authorizations: readonly EveAuthorizationPart[];
};

function isReasoningPart(
  part: EveMessagePart,
): part is Extract<EveMessagePart, { type: "reasoning" }> {
  return part.type === "reasoning";
}

/**
 * The turn's reasoning, or `null` when the model produced none. An empty-text
 * block that is still streaming is *not* nothing: it is the moment before the
 * first thought arrives, and the disclosure has to exist to say "Working…".
 */
export function messageReasoning(message: EveMessage): AssistantTurnReasoning | null {
  if (message.role !== "assistant") {
    return null;
  }

  const parts = message.parts.filter(isReasoningPart);
  if (parts.length === 0) {
    return null;
  }

  return {
    streaming: parts.some((part) => part.state === "streaming"),
    text: parts
      .map((part) => part.text.trim())
      .filter((text) => text.length > 0)
      .join("\n\n"),
  };
}

/**
 * Mid-turn sign-in challenges (an OAuth connect the tool needs before it can
 * run). eve projects these as their own part; a turn carrying nothing else would
 * otherwise render as an empty bubble with no way forward.
 */
export function messageAuthorizations(message: EveMessage): EveAuthorizationPart[] {
  if (message.role !== "assistant") {
    return [];
  }
  return message.parts.filter(
    (part): part is EveAuthorizationPart => part.type === "authorization",
  );
}

/**
 * Files carried by a message of the owner's own.
 *
 * Role-scoped because that is where the data actually is: eve builds a `file`
 * part with a resolved `url` when it projects what the *user* sent, and an
 * assistant turn's own attachments arrive as tool output instead. Collecting
 * them from every role read as generic but rendered nothing, which made the
 * attachment strip look wired up when it was reachable only in theory.
 */
export function messageFiles(message: EveMessage): AssistantFilePart[] {
  if (message.role !== "user") {
    return [];
  }
  return message.parts.filter((part): part is AssistantFilePart => part.type === "file");
}

/**
 * Splits a turn's units into the activity list and the cards below the answer.
 * The anatomy's one real decision, kept as a plain function over plain data so
 * {@link messageTurnAnatomy}'s tests prove it without mounting a panel.
 */
function partitionTurnUnits(units: readonly AssistantTurnUnit[]): {
  activity: AssistantActivityStep[];
  cards: AssistantTurnCardUnit[];
} {
  const activity: AssistantActivityStep[] = [];
  const cards: AssistantTurnCardUnit[] = [];

  for (const unit of units) {
    if (unit.type === "active") {
      activity.push({
        description: null,
        ...(unit.active.specialist ? { specialist: unit.active.specialist } : {}),
        label: unit.active.label,
        status: "active",
        toolCallId: unit.active.toolCallId,
      });
      continue;
    }

    if (unit.type === "single" && toolViewTier(unit.entry.view) === "line") {
      activity.push({
        description: resultViewSummary(unit.entry.view),
        ...(unit.entry.toolName.startsWith("subagent:")
          ? { specialist: unit.entry.toolName.slice(9) }
          : {}),
        label: completedToolLabel(unit.entry.toolName),
        status: "complete",
        toolCallId: unit.entry.toolCallId,
      });
      continue;
    }

    cards.push(unit);
  }

  return { activity, cards };
}

/**
 * Everything one assistant turn renders, in anatomical order. `turnInFlight`
 * has the same meaning it has for {@link messageTurnUnits}: only the live turn
 * may show work in progress.
 */
export function messageTurnAnatomy(
  message: EveMessage,
  turnInFlight: boolean,
): AssistantTurnAnatomy {
  const { activity, cards } = partitionTurnUnits(messageTurnUnits(message, turnInFlight));
  return {
    activity,
    authorizations: messageAuthorizations(message),
    cards,
    reasoning: messageReasoning(message),
  };
}

import type { EveDynamicToolPart, EveMessage, EveMessagePart, UseEveAgentStatus } from "eve/react";
// This lib→components import is deliberate: message-views is the chat view-model glue
// that turns Eve message parts into renderable turn units, and the result-module
// registry is the single source for projection and grouping. Co-locating each kind's
// projection with its (JSX) rendering is the whole point of the registry, so the
// projection dispatcher necessarily lives in the component layer; this module is only
// used by the client assistant panel, so the direction costs nothing.
import {
  type GroupableToolKind,
  isGroupableToolKind,
  toAssistantToolView,
} from "@/components/assistant-results/registry";
import { activeToolLabel } from "./active-tool-label";
import type { AssistantToolView } from "./tool-result-view";

function isTextPart(part: EveMessagePart): part is Extract<EveMessagePart, { type: "text" }> {
  return part.type === "text";
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

  return message.parts.filter(isCompletedToolPart).map((part) => ({
    toolCallId: part.toolCallId,
    view: toAssistantToolView({ toolName: part.toolName, output: part.output }),
  }));
}

/** One in-flight tool call, surfaced as a transient "working" shimmer line. */
export type AssistantActiveTool = {
  readonly toolCallId: string;
  readonly label: string;
};

/**
 * Whether Eve is still working: `submitted` (the turn is sent, no events yet)
 * and `streaming` (events arriving) are the only live states. `ready` and
 * `error` are both verdicts on a turn that is over - one settled, one failed -
 * and neither leaves anything running.
 */
export function isTurnInFlight(status: UseEveAgentStatus): boolean {
  return status === "submitted" || status === "streaming";
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

  return message.parts.filter(isActiveToolPart).map((part) => ({
    toolCallId: part.toolCallId,
    label: activeToolLabel(part.toolName),
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
    };

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
export function groupTurnToolEntries(entries: readonly AssistantToolEntry[]): AssistantTurnUnit[] {
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

  return slots.map((slot): AssistantTurnUnit => {
    if (!isPendingGroup(slot)) {
      return slot;
    }
    const [first, ...rest] = slot.entries;
    return rest.length > 0
      ? { type: "group", kind: slot.kind, entries: slot.entries }
      : { type: "single", entry: first };
  });
}

import type { AssertionHandle, EveEvalAssertions } from "eve/evals";

type EvalEvent = {
  type?: unknown;
  data?: unknown;
};

type ActionRequestedEvent = {
  type: "actions.requested";
  data: {
    actions: Array<{
      kind?: string;
      toolName?: string;
    }>;
  };
};

/**
 * Every stream event that proves a delegation happened, whichever way it ran.
 *
 * eve 0.32 emits `subagent.called` for a child workflow session (`data.name`),
 * `subagent.started`/`subagent.event`/`subagent.completed` for an inline one
 * (`data.subagentName`). Reading all four means a delegation cannot hide behind
 * an execution mode the eval did not think to check.
 */
const SUBAGENT_EVENT_TYPES = [
  "subagent.called",
  "subagent.started",
  "subagent.event",
  "subagent.completed",
] as const;

export function requestedTool(events: readonly unknown[], toolName: string): boolean {
  return events.some(
    (event) =>
      isActionRequestedEvent(event) &&
      event.data.actions.some(
        (action) => action.kind === "tool-call" && action.toolName === toolName,
      ),
  );
}

export function usedSubagent(events: readonly unknown[], subagentName: string): boolean {
  return events.some((event) => subagentNameOf(event) === subagentName);
}

/** Stream position of the first request for a tool, or -1. For ordering claims. */
export function firstToolRequestIndex(events: readonly unknown[], toolName: string): number {
  return events.findIndex(
    (event) =>
      isActionRequestedEvent(event) &&
      event.data.actions.some(
        (action) => action.kind === "tool-call" && action.toolName === toolName,
      ),
  );
}

/** Stream position of the first delegation to a subagent, or -1. For ordering claims. */
export function firstSubagentIndex(events: readonly unknown[], subagentName: string): number {
  return events.findIndex((event) => subagentNameOf(event) === subagentName);
}

export function usedRelationshipStrategyPath(events: readonly unknown[]): boolean {
  return (
    requestedTool(events, "get_relationship_agenda") ||
    usedSubagent(events, "relationship_strategist")
  );
}

/**
 * The absence assertion eve 0.32 does not ship.
 *
 * The framework has `calledSubagent` but no `notCalledSubagent`, and
 * `notCalledTool` cannot stand in for one: `derived.toolCalls` holds authored
 * tool calls only, so `notCalledTool("privacy_guard")` is true of every run
 * ever recorded, including the ones that delegated to Privacy Guard on every
 * step. Any eval that means "and it did not hand this to a subagent" has to
 * read the raw stream, which is what this does.
 *
 * Replace this with the framework assertion if a later eve version grows one.
 */
export function notCalledSubagent(t: EveEvalAssertions, subagentName: string): AssertionHandle {
  return t.eventsSatisfy(`did not delegate to the ${subagentName} subagent`, (events) =>
    events.every((event) => subagentNameOf(event) !== subagentName),
  );
}

/**
 * The other half of `usedNoTools()`, for the same reason.
 *
 * `usedNoTools()` counts authored tool calls, so a turn that answered by
 * delegating the whole question to a subagent - which then called whatever
 * tools it liked - satisfies it. An eval whose claim is "nothing was reached
 * for here" needs both.
 */
export function usedNoSubagents(t: EveEvalAssertions): AssertionHandle {
  return t.eventsSatisfy("delegated to no subagent", (events) =>
    events.every((event) => subagentNameOf(event) === null),
  );
}

/** Both halves of "it reached for nothing": no authored tool, no delegation. */
export function usedNoToolsOrSubagents(t: EveEvalAssertions): void {
  t.usedNoTools();
  usedNoSubagents(t);
}

/** The subagent one stream event belongs to, or null when it is not a subagent event. */
function subagentNameOf(event: unknown): string | null {
  if (!isEvalEvent(event)) return null;
  if (!SUBAGENT_EVENT_TYPES.some((type) => type === event.type)) return null;
  if (!isRecord(event.data)) return null;

  const { name, subagentName } = event.data;
  if (typeof subagentName === "string") return subagentName;
  return typeof name === "string" ? name : null;
}

function isActionRequestedEvent(event: unknown): event is ActionRequestedEvent {
  if (!isEvalEvent(event) || event.type !== "actions.requested") return false;
  if (!isRecord(event.data)) return false;
  if (!Array.isArray(event.data.actions)) return false;

  return event.data.actions.every(
    (action) =>
      isRecord(action) &&
      (action.kind === undefined || typeof action.kind === "string") &&
      (action.toolName === undefined || typeof action.toolName === "string"),
  );
}

function isEvalEvent(event: unknown): event is EvalEvent {
  return isRecord(event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

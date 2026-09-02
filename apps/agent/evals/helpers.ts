import type {
  AssertionHandle,
  EveEvalAssertions,
  EveEvalContext,
  EveEvalTurn,
  InputRequest,
} from "eve/evals";
import { APPROVAL_APPROVE_OPTION_ID, APPROVAL_REQUEST_KIND } from "../agent/lib/approval";
import { calledToolNames, requestedApproval } from "./expectations";

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

/**
 * The part of an eval session an approval round needs. eve exports the session
 * driver's interface only through `EveEvalContext` and `EveEvalSession`, so
 * name the one method here rather than depending on either whole surface.
 */
type ApprovalResponder = Pick<EveEvalContext, "respond">;

/** How many approval rounds one turn may need before the harness gives up. */
const MAX_APPROVAL_ROUNDS = 5;

/**
 * Answer every parked owner approval with Approve and let the turn finish.
 *
 * Gated tools park the turn at `waiting` instead of executing, which would
 * leave every behavior eval graded on half a turn. These evals are about what
 * Eve *does once allowed*, not about the gate — the gate has deterministic
 * policy tests (ADR-0059) — so the harness plays the owner who says yes, and
 * `requestedApprovalFor` is how an eval asserts it was asked at all.
 *
 * This is the mechanism; `defineEval` in `./define-eval` is where it becomes the
 * default, so an eval gets it without asking. It is exported for the two places
 * that answer explicitly: {@link sendApproving}, and the harness tests.
 *
 * Only tool approvals are answered. An `ask_question` prompt is the model
 * asking, not the gate, and an eval that wants one still answers it itself.
 */
export async function approveToolApprovals(
  session: ApprovalResponder,
  turn: EveEvalTurn,
): Promise<EveEvalTurn> {
  let current = turn;

  for (let round = 0; round < MAX_APPROVAL_ROUNDS; round += 1) {
    if (current.status !== "waiting") return current;

    const pending = current.inputRequests.filter(isToolApprovalRequest);
    if (pending.length === 0) return current;

    current = await session.respond(
      pending.map((request) => ({
        requestId: request.requestId,
        optionId: APPROVAL_APPROVE_OPTION_ID,
      })),
    );
  }

  return current;
}

/**
 * `t.send`, then approve whatever the turn parked on.
 *
 * The same thing `t.send` already does under `defineEval`. Kept as the explicit
 * spelling for an eval that wants the approving read at its call site, and as
 * the seam the harness tests drive directly.
 */
export async function sendApproving(t: EveEvalContext, message: string): Promise<EveEvalTurn> {
  return await approveToolApprovals(t, await t.send(message));
}

/** Assert the owner was asked before `toolName` did anything. */
export function requestedApprovalFor(t: EveEvalAssertions, toolName: string): AssertionHandle {
  return t.eventsSatisfy(`asked the owner to approve ${toolName}`, (events) =>
    requestedApproval(events, toolName),
  );
}

function isToolApprovalRequest(request: InputRequest): boolean {
  return request.kind === APPROVAL_REQUEST_KIND;
}

export function usedSubagent(events: readonly unknown[], subagentName: string): boolean {
  return events.some((event) => subagentNameOf(event) === subagentName);
}

/**
 * Pure allowlist predicate for boundary evals whose contract is "no capability or
 * mutation tool", not "the model must call nothing at all". Framework grounding
 * (`load_skill`) and owner-scoped read tools are safe to permit explicitly; an
 * unknown or mutating tool keeps the boundary red.
 */
export function usesOnlyAllowedTools(
  events: readonly unknown[],
  allowedTools: readonly string[],
): boolean {
  const allowed = new Set(allowedTools);
  return calledToolNames(events).every((toolName) => allowed.has(toolName));
}

/** Assert a precise tool allowlist while leaving subagent absence explicit to the caller. */
export function usedOnlyAllowedTools(
  t: EveEvalAssertions,
  allowedTools: readonly string[],
): AssertionHandle {
  return t.eventsSatisfy(
    `used only allowlisted tools (${allowedTools.join(", ") || "none"})`,
    (events) => usesOnlyAllowedTools(events, allowedTools),
  );
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
    hasCompletedToolResult(events, "get_relationship_agenda") ||
    hasCompletedSubagentOutput(events, "relationship_strategist")
  );
}

/** A direct grounding call only counts once Eve received a successful final result. */
function hasCompletedToolResult(events: readonly unknown[], toolName: string): boolean {
  return events.some((event) => {
    if (!isEvalEvent(event) || event.type !== "action.result" || !isRecord(event.data)) {
      return false;
    }
    const result = event.data.result;
    return (
      event.data.status === "completed" &&
      isRecord(result) &&
      result.toolName === toolName &&
      result.isError !== true &&
      "output" in result
    );
  });
}

/** A delegated grounding path only counts after the named child emitted output. */
function hasCompletedSubagentOutput(events: readonly unknown[], subagentName: string): boolean {
  return events.some((event) => {
    if (!isEvalEvent(event) || event.type !== "subagent.completed" || !isRecord(event.data)) {
      return false;
    }
    const { output, subagentName: completedName } = event.data;
    return completedName === subagentName && typeof output === "string" && output.trim().length > 0;
  });
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

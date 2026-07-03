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

type SubagentEvent = {
  type: "subagent.called" | "subagent.completed";
  data: {
    name?: string;
    subagentName?: string;
  };
};

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
  return events.some((event) => {
    if (!isSubagentEvent(event)) return false;

    return event.data.name === subagentName || event.data.subagentName === subagentName;
  });
}

export function usedRelationshipStrategyPath(events: readonly unknown[]): boolean {
  return (
    requestedTool(events, "get_relationship_agenda") ||
    usedSubagent(events, "relationship_strategist")
  );
}

export function usedDraftingPath(events: readonly unknown[]): boolean {
  return usedSubagent(events, "message_drafter") || requestedTool(events, "get_person_context");
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

function isSubagentEvent(event: unknown): event is SubagentEvent {
  if (!isEvalEvent(event)) return false;
  if (event.type !== "subagent.called" && event.type !== "subagent.completed") return false;
  if (!isRecord(event.data)) return false;

  return (
    (event.data.name === undefined || typeof event.data.name === "string") &&
    (event.data.subagentName === undefined || typeof event.data.subagentName === "string")
  );
}

function isEvalEvent(event: unknown): event is EvalEvent {
  return isRecord(event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

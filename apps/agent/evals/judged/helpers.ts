import type { EveEvalTurn } from "eve/evals";

type SubagentCompletedEvent = {
  type: "subagent.completed";
  data: {
    callId: string;
    output: string;
    subagentName: string;
  };
};

export function subagentOutput(turn: EveEvalTurn, subagentName: string): string {
  for (let index = turn.events.length - 1; index >= 0; index -= 1) {
    const event = turn.events[index];
    if (isSubagentCompletedEvent(event) && event.data.subagentName === subagentName) {
      return event.data.output;
    }
  }

  return "";
}

function isSubagentCompletedEvent(event: unknown): event is SubagentCompletedEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "subagent.completed" &&
    "data" in event &&
    typeof event.data === "object" &&
    event.data !== null &&
    "callId" in event.data &&
    typeof event.data.callId === "string" &&
    "subagentName" in event.data &&
    typeof event.data.subagentName === "string" &&
    "output" in event.data &&
    typeof event.data.output === "string"
  );
}

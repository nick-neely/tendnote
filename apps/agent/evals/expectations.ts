/**
 * Assertion helpers for the Eve evals: the shapes `eve/evals/expect` does not provide.
 *
 * `includes()` has no negation, and the absence assertions are the load-bearing half of the
 * asset evals — an answer that names a co-member's private receipt, states an unreviewed
 * suggestion as a fact, prints a raw id, or promises a capability that does not exist has
 * failed no matter how well the rest of it reads.
 */

/**
 * A matcher-ready regex that matches only text WITHOUT the given pattern.
 *
 * Bans belong on *claims*, never on topics: "I'm not an OCR tool" is the right answer and must
 * pass, while "I'll pull the total off it once you upload" is the failure. A topic ban would
 * fail the refusal for naming the thing it refused.
 */
export function without(pattern: string): RegExp {
  return new RegExp(`^(?![\\s\\S]*(?:${pattern}))[\\s\\S]*$`, "i");
}

/** A record id in an answer is always a bug — ids are for tool calls, never for people. */
export const NO_RAW_IDS = without("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}");

export type ToolResult = { toolName?: string; output?: unknown };

export type ToolCall = { toolName: string; input?: unknown };

/**
 * The tool result carried by an event, or null when the event is not one.
 *
 * A delegated turn's results are one level down. eve 0.32 wraps every stream event
 * an inline subagent produces in a `subagent.event`, with the child's own event
 * under `data.event` - so a scan of the top level alone sees no tool results at all
 * on exactly the runs that delegated, and an eval that judges an answer against the
 * records it loaded judges it against nothing instead.
 */
export function toolResultOf(event: unknown): ToolResult | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }
  const candidate = event as { type?: string; data?: { result?: ToolResult; event?: unknown } };
  if (candidate.type === "subagent.event") {
    return toolResultOf(candidate.data?.event);
  }
  if (candidate.type !== "action.result") {
    return null;
  }
  return candidate.data?.result ?? null;
}

/** Every tool result in a turn, including results emitted by an inline subagent. */
export function toolResults(events: readonly unknown[]): ToolResult[] {
  return events.flatMap((event) => {
    const result = toolResultOf(event);
    return result === null ? [] : [result];
  });
}

/**
 * What a tool actually returned this turn — so an eval can assert on what Eve was *told*, not
 * only on what she said. An empty proposal pass, for instance, is only meaningful if the seam
 * really did return nothing.
 */
export function toolOutputs(events: readonly unknown[], toolName: string): unknown[] {
  return toolResults(events)
    .filter((result) => result.toolName === toolName)
    .map((result) => result.output);
}

/** Every authored tool call in a turn, including nested subagent events. */
export function toolCalls(events: readonly unknown[]): ToolCall[] {
  return events.flatMap((event) => {
    if (typeof event !== "object" || event === null) return [];

    const candidate = event as {
      type?: string;
      data?: { actions?: unknown; event?: unknown };
    };
    if (candidate.type === "subagent.event") {
      return toolCalls(candidate.data?.event === undefined ? [] : [candidate.data.event]);
    }
    if (candidate.type !== "actions.requested" || !Array.isArray(candidate.data?.actions)) {
      return [];
    }

    return candidate.data.actions.flatMap((action): ToolCall[] => {
      if (typeof action !== "object" || action === null) return [];
      const candidateAction = action as { kind?: unknown; toolName?: unknown; input?: unknown };
      if (candidateAction.kind !== "tool-call" || typeof candidateAction.toolName !== "string") {
        return [];
      }
      return [{ toolName: candidateAction.toolName, input: candidateAction.input }];
    });
  });
}

/** Tool names are a convenient public seam for recursive no-write assertions. */
export function calledToolNames(events: readonly unknown[]): string[] {
  return [
    ...toolCalls(events).map((call) => call.toolName),
    ...toolResults(events)
      .map((result) => result.toolName)
      .filter((toolName): toolName is string => typeof toolName === "string"),
  ];
}

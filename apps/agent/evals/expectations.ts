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

type ToolResult = { toolName?: string; output?: unknown };

/**
 * The tool result carried by an event, or null when the event is not one.
 *
 * A delegated turn's results are one level down. eve 0.32 wraps every stream event
 * an inline subagent produces in a `subagent.event`, with the child's own event
 * under `data.event` - so a scan of the top level alone sees no tool results at all
 * on exactly the runs that delegated, and an eval that judges an answer against the
 * records it loaded judges it against nothing instead.
 */
function toolResultOf(event: unknown): ToolResult | null {
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

/**
 * What a tool actually returned this turn — so an eval can assert on what Eve was *told*, not
 * only on what she said. An empty proposal pass, for instance, is only meaningful if the seam
 * really did return nothing.
 */
export function toolOutputs(events: readonly unknown[], toolName: string): unknown[] {
  const outputs: unknown[] = [];
  for (const event of events) {
    const result = toolResultOf(event);
    if (result !== null && result.toolName === toolName) {
      outputs.push(result.output);
    }
  }
  return outputs;
}

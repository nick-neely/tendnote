import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * What a withheld tool reports when the model calls it anyway: that nothing
 * happened, and why. `mode` is set by the Eve mode gate, `skills` by progressive
 * disclosure.
 */
export type WithheldToolResult = {
  readonly performed: false;
  readonly tool: string;
  readonly message: string;
  readonly mode?: string;
  readonly skills?: readonly string[];
};

/**
 * The one definition every withheld tool name is rebound to.
 *
 * eve 0.47 cannot delete an authored tool from a turn, only rebind its name, so
 * both the mode gate (`tools/eve_mode_gate.ts`) and progressive disclosure
 * (`tools/eve_tool_disclosure.ts`) withhold a tool by returning this in its
 * place. It has no input schema and runs nothing.
 *
 * ## Why both resolvers share this builder
 *
 * eve keeps one process-wide registry of dynamic tool callbacks, keyed by tool
 * name, and the last resolver to register a name wins. The gate and disclosure
 * both bind names like `add_gift_idea`, in different sessions served by the same
 * process. Two different `execute` bodies would overwrite each other there, and
 * one session's call would run the other resolver's callback against its own
 * closure. Built here, every withheld name registers this same callback, and the
 * only per-call difference is the `result` it captured.
 */
export function withheldTool(description: string, result: WithheldToolResult) {
  return defineTool({
    description,
    inputSchema: z.looseObject({}),
    execute() {
      return result;
    },
  });
}

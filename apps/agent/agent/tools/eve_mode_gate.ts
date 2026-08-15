import {
  type DynamicResolveContext,
  type DynamicToolSet,
  defineDynamic,
  defineTool,
} from "eve/tools";
import { z } from "zod";
import {
  EVE_TOOL_NAMES,
  type EveMode,
  type EveToolName,
  eveModeDefinition,
  resolveSessionEveMode,
  toolsUnavailableInMode,
} from "../lib/eve-modes";

/**
 * The Eve mode gate: the file that makes ADR-0128 narrowing real.
 *
 * Eve resolves the mode for every turn from the principal the channel's own
 * `AuthFn` stamped, then withholds every authored tool that mode does not
 * allow. The trusted-signal rule and the mode table both live in
 * `lib/eve-modes.ts`; this file only applies them.
 *
 * ## Why the withheld tools are replaced rather than removed
 *
 * A dynamic resolver in eve 0.32.0 can add a tool or *override* an authored one
 * by name, but it cannot delete an authored tool from the compiled set: the
 * tool loop merges the resolved set over the static one right before each model
 * call. Withholding is therefore expressed the only way the framework allows -
 * the tool name is rebound to a definition that runs nothing and reports why.
 * The authored executor is unreachable for the whole turn, which is the part
 * that matters: the model can still see the name, but no mode can be talked
 * into performing an action it does not allow.
 *
 * In `web_chat` - every real session today - the resolver returns `null`, so
 * the curated surface is offered exactly as authored and the prompt is byte for
 * byte what it was before this file existed.
 *
 * Resolution runs on `turn.started` rather than `session.started` because
 * `auth.current` is the caller of the active turn: a session opened by one
 * principal must not keep that principal's authority for another's turn.
 *
 * ## Why nothing in here is allowed to throw
 *
 * eve 0.32 *skips* a dynamic resolver that throws: the turn proceeds with the
 * static compiled set, which is the full authored surface. A gate that fails is
 * therefore a gate that fails open, and the session it would have failed on is
 * by definition the one whose principal it could not make sense of. So the
 * principal is read defensively and the resolution is caught below, with the
 * most restrictive answer the table has as the fallback: an unreadable session
 * gets `restricted`, exactly as an unrecognised one does.
 */

/** What the gate withholds this turn: the mode's answer, or the strictest one. */
type WithholdingPlan = {
  readonly mode: EveMode;
  readonly unavailable: readonly EveToolName[];
  readonly availableHere: string;
};

const NOTHING_AVAILABLE = "No tools are available in this mode.";

/** The fallback: every authored tool withheld, named as the restricted mode. */
const RESTRICTED_PLAN: WithholdingPlan = {
  mode: "restricted",
  unavailable: EVE_TOOL_NAMES,
  availableHere: NOTHING_AVAILABLE,
};

function withholdingPlan(ctx: DynamicResolveContext): WithholdingPlan {
  try {
    // Optional all the way down on purpose: a context arriving without the
    // session or its auth is the shape this resolver must not throw on.
    const mode = resolveSessionEveMode(ctx.session?.auth?.current ?? null);
    const allowed = eveModeDefinition(mode).tools;
    return {
      mode,
      unavailable: toolsUnavailableInMode(mode),
      availableHere:
        allowed.length === 0
          ? NOTHING_AVAILABLE
          : `Tools available in this mode: ${allowed.join(", ")}.`,
    };
  } catch {
    return RESTRICTED_PLAN;
  }
}

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const { mode, unavailable, availableHere } = withholdingPlan(ctx);
      if (unavailable.length === 0) return null;

      // Built with a loop and an assignment rather than `Object.fromEntries`
      // over array literals: eve's bundler transform hoists each inline
      // `execute` so it survives replay, and its walker does not descend into
      // array elements. An array literal here would compile and then quietly
      // lose every gated tool the moment a turn replayed.
      const withheld: Record<string, DynamicToolSet[string]> = {};
      for (const toolName of unavailable) {
        withheld[toolName] = defineTool({
          description: `Unavailable in ${mode} mode. Calling it does nothing. ${availableHere}`,
          inputSchema: z.looseObject({}),
          execute() {
            return {
              performed: false,
              tool: toolName,
              mode,
              message: `${toolName} is not available in ${mode} mode, so nothing was done. Tell the user this cannot be done here instead of retrying or reporting it as done.`,
            };
          },
        });
      }

      return withheld;
    },
  },
});

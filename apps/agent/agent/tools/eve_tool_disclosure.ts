import { type DynamicResolveContext, type DynamicToolSet, defineDynamic } from "eve/tools";
import { resolveSessionEveMode } from "../lib/eve-modes";
import {
  disclosedToolFamilies,
  type UndisclosedTool,
  undisclosedTools,
} from "../lib/tool-disclosure";
import { withheldTool } from "../lib/withheld-tool";

/**
 * Progressive tool disclosure (ADR-0227): the file that keeps undisclosed Tool
 * Families' schemas off the interactive surface. The family table and the rule
 * live in `lib/tool-disclosure.ts`; this file only applies them.
 *
 * Each undisclosed tool is rebound to an inert definition with no input schema
 * whose description names the skills that disclose it. The model still
 * sees the name, which is how it knows what loading the skill will give it; it
 * does not pay for the schema until then.
 *
 * ## Why `step.started`
 *
 * A skill loaded mid-turn has to disclose its tools for the very next model
 * call, not the next turn, or the turn that loaded it could not use it.
 *
 * ## Why a failure here returns nothing
 *
 * The mode gate fails closed because it is the authority. This file is not: its
 * failure direction is cost. A resolver that cannot read the session withholds
 * nothing, so the turn ships every schema the gate left in place, which is what
 * every turn shipped before disclosure existed.
 */

function undisclosedThisStep(ctx: DynamicResolveContext): readonly UndisclosedTool[] {
  try {
    // Optional all the way down, the way the mode gate reads its session.
    const mode = resolveSessionEveMode(ctx.session?.auth?.current ?? null);
    return undisclosedTools(mode, disclosedToolFamilies(ctx.messages));
  } catch {
    return [];
  }
}

/** `"a"`, `"a" or "b"`, `"a", "b", or "c"`: the skills to load, as the model reads them. */
function skillChoice(skills: readonly string[]): string {
  const quoted = skills.map((skill) => `"${skill}"`);
  if (quoted.length <= 2) return quoted.join(" or ");
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted.at(-1)}`;
}

export default defineDynamic({
  events: {
    "step.started": (_event, ctx) => {
      const undisclosed = undisclosedThisStep(ctx);
      if (undisclosed.length === 0) return null;

      const withheld: Record<string, DynamicToolSet[string]> = {};
      for (const { tool, skills } of undisclosed) {
        const choice = skillChoice(skills);
        withheld[tool] = withheldTool(`Not loaded: call load_skill with ${choice} to use it.`, {
          performed: false,
          tool,
          skills,
          message: `${tool} is not loaded yet, so nothing was done. Call load_skill with ${choice}, then call ${tool} again.`,
        });
      }
      return withheld;
    },
  },
});

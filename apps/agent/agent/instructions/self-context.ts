import { getOrientationContext } from "@tendnote/db/queries/context-facts";
import { defineDynamic, defineInstructions } from "eve/instructions";
import {
  buildSelfContextInstructionsMarkdown,
  buildUnavailableSelfContextInstructionsMarkdown,
  resolveOrientationCaller,
} from "../lib/self-context-orientation";

/**
 * Re-loads the caller's authoritative orientation after every accepted turn so
 * a direct Eve mutation becomes visible on the next turn. The database read is
 * best-effort: no context is safer than failing the conversation or inventing a
 * replacement answer when the projection is unavailable.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const callerUserId = resolveOrientationCaller(ctx);
      if (!callerUserId) return null;

      try {
        const orientation = await getOrientationContext({ callerUserId }, async () => callerUserId);
        return defineInstructions({
          markdown: buildSelfContextInstructionsMarkdown(orientation.serialized),
        });
      } catch {
        return defineInstructions({
          markdown: buildUnavailableSelfContextInstructionsMarkdown(),
        });
      }
    },
  },
});

import { hasSavedAPerson } from "@tendnote/db/queries/first-run";
import { defineDynamic, defineInstructions } from "eve/instructions";
import { interactiveOwnerUserId } from "../lib/approval/interactive-owner";
import { FIRST_CAPTURE_STEER } from "../lib/first-capture-steer";

/**
 * The life-admin steer, stated only while the owner has no person saved (#639).
 *
 * Re-read on every turn, because the turn that saves the first person is the one
 * after which the steer must stop. The caller check is the interactive owner's:
 * a Discord capture or a scheduled run has nobody to steer. A failed read says
 * nothing, since a missing steer costs one sentence and a wrong one nags.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const ownerUserId = interactiveOwnerUserId(ctx);
      if (ownerUserId === null) return null;

      try {
        if (await hasSavedAPerson({ userId: ownerUserId })) return null;
      } catch {
        return null;
      }

      return defineInstructions({ content: FIRST_CAPTURE_STEER });
    },
  },
});

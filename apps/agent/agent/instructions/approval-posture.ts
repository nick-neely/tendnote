import { defineDynamic, defineInstructions } from "eve/instructions";
import { approvalPolicyDependencies } from "../lib/approval/dependencies-production";
import { approvalPostureInstruction } from "../lib/approval-posture";
import { resolveConversationTaint } from "../lib/conversation-taint";
import { resolveOrientationCaller } from "../lib/self-context-orientation";

/**
 * States this conversation's approval posture once per turn, in the same words
 * the owner's own setting means (ADR-0240).
 *
 * Re-resolved on `turn.started` rather than `session.started` because both
 * inputs move: the owner can change their Approval Mode mid-conversation, and a
 * conversation becomes a Tainted Conversation the moment something reads a web
 * page. Both are read the same way the policy reads them - the mode through the
 * injected dependency, the taint from the state slot with the message history as
 * the backstop - so the paragraph and the decisions cannot disagree.
 *
 * The caller check is the orientation one: a session with no directly
 * authenticated human owner has no Approval Mode to state, and a subagent turn
 * is denied by the policy outright, so the paragraph would be a description of a
 * posture that does not apply.
 *
 * A failed mode read yields the `ask` paragraph, matching the policy exactly: an
 * unreadable mode parks, so telling the model that saves pause is the truth.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const callerUserId = resolveOrientationCaller(ctx);
      if (!callerUserId) return null;

      const tainted = resolveConversationTaint(ctx.messages).tainted;

      let mode: "ask" | "trusted" = "ask";
      try {
        const read = await approvalPolicyDependencies().readApprovalMode({ userId: callerUserId });
        if (read === "trusted") mode = "trusted";
      } catch {
        // Unreadable is `ask`, which is also what the policy will do.
      }

      return defineInstructions({ content: approvalPostureInstruction({ mode, tainted }) });
    },
  },
});

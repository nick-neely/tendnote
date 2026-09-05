import { defineDynamic, defineInstructions } from "eve/instructions";
import { resolveApprovalPolicyDependencies } from "../lib/approval/dependencies";
import { interactiveOwnerUserId } from "../lib/approval/interactive-owner";
import { approvalPostureInstruction } from "../lib/approval-posture";
import { resolveConversationTaint } from "../lib/conversation-taint";

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
 * The caller check is the policy's own `interactiveOwnerUserId`, and it has to
 * be: a session the policy would deny has no posture to describe. A looser check
 * would tell a `discord_capture` or `scheduled_workflow` turn that its
 * reversible private saves run immediately, when every gated call it makes is
 * denied outright.
 *
 * A failed mode read yields the `ask` paragraph, matching the policy exactly: an
 * unreadable mode parks, so telling the model that saves pause is the truth.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const callerUserId = interactiveOwnerUserId(ctx);
      if (callerUserId === null) return null;

      const tainted = resolveConversationTaint(ctx.messages).tainted;

      let mode: "ask" | "trusted" = "ask";
      try {
        const dependencies = await resolveApprovalPolicyDependencies();
        const read = await dependencies.readApprovalMode({ userId: callerUserId });
        if (read === "trusted") mode = "trusted";
      } catch {
        // Unreadable is `ask`, which is also what the policy will do.
      }

      return defineInstructions({ content: approvalPostureInstruction({ mode, tainted }) });
    },
  },
});

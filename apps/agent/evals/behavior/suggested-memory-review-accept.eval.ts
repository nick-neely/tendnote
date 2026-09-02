import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { NO_RAW_IDS, without } from "../expectations";

/**
 * The accept path of the review queue, which existed only as a prohibition.
 *
 * `approve_suggested_memory` appeared in the suite exclusively as
 * `notCalledTool` - the rule that Eve never approves on the user's behalf. True
 * and important, and it says nothing about whether approving works when the user
 * does ask. The queue is the product's whole answer to "how does a tentative
 * fact become a real one"; it was covered by the promise that Eve would not use
 * it.
 *
 * The two turns are the gate itself: the first shows the suggestions and must
 * not approve any of them, the second approves the one the user names.
 */
export default defineEval({
  description:
    "A suggested memory is shown for review, then approved only when the user explicitly says so.",
  tags: ["deterministic", "behavior", "memory", "review-gate"],
  // 2 turns against a live model, so the run-wide single-turn budget does not fit.
  timeoutMs: 120_000,
  async test(t) {
    const shown = await t.send("What memory suggestions do I have waiting for review?");

    shown.expectOk();
    shown.calledTool("list_suggested_memory_reviews");
    // Showing is not accepting. This is the half the existing evals already guard, kept
    // here because it is the precondition for the turn that follows.
    shown.notCalledTool("approve_suggested_memory");
    shown.notCalledTool("dismiss_suggested_memory");

    await t.send("Approve the one about Jordan waiting on the interview outcome.");

    t.succeeded();
    // The id is the one the review read returned; there is no other source for it.
    t.calledTool("approve_suggested_memory", { count: 1 });
    // One suggestion, the one they named. The queue is not emptied on their behalf.
    t.notCalledTool("dismiss_suggested_memory");
    t.notCalledTool("capture_memory");
    t.check(t.reply, includes(NO_RAW_IDS));
    // And it does not describe the approved fact as still pending.
    t.check(
      t.reply,
      includes(without("still (waiting|pending)|waiting for (your )?review|not yet approved")),
    );
  },
});

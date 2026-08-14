import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "A planning request never silently creates active General Actions.",
  tags: ["deterministic", "behavior", "general-actions"],
  async test(t) {
    await t.send("Help me plan a weekend camping trip — what should I get done beforehand?");

    t.succeeded();
    // Planning is review-gated at most: it may propose suggestions, but it must never
    // put active actions on the ledger from a brainstorming ask (ADRs 0159, 0163).
    t.notCalledTool("create_general_action");
    t.notCalledTool("update_general_action_status");
    t.notCalledTool("edit_general_action");
    // The positive half, which this eval lacked: refusing to write is only correct if the
    // planning help still happens. A regression that answered "I can't do that" would have
    // passed every gate above.
    //
    // Neither gate uses a word from the prompt ("camping", "trip", "weekend", "plan"),
    // and the second is structural rather than a list of accepted sentences: what Eve
    // owes here is a plan she offers, not one she files.
    t.check(
      t.reply,
      includes(/tent|sleeping bag|gear|pack|supplies|food|water|reserve|book|permit|checklist/i),
    );
    t.check(t.reply, includes(/\?|want me to|I can add|let me know|if you(’|')?d like/i));
  },
});

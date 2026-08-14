import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";

/**
 * The active follow-up lifecycle, end to end, which nothing exercised.
 *
 * Every follow-up eval in the suite was a `notCalledTool("create_followup")` -
 * so the whole feature was covered by the promise that Eve would not use it. A
 * regression that made `create_followup` or `update_followup_status` unreachable
 * (a broken schema, a store error swallowed as a refusal) passed the entire
 * deterministic tag.
 *
 * The three turns are the three states a reminder actually moves through, and
 * each depends on the last: the snooze can only be aimed at a follow-up the read
 * turn surfaced, and the read can only surface one the create turn wrote.
 */
export default defineEval({
  description:
    "An explicit reminder is created, read back, and moved out - the active follow-up lifecycle.",
  tags: ["deterministic", "behavior", "followups", "lifecycle"],
  // 3 turns against a live model, so the run-wide single-turn budget does not fit.
  timeoutMs: 180_000,
  async test(t) {
    // Dana deliberately: every other seeded person already carries a follow-up, and a
    // second one about the same person turns the third turn into a disambiguation.
    const created = await t.send(
      "Remind me to send Dana Kim my follow-up question about the ops notes on Friday.",
    );

    created.expectOk();
    created.calledTool("search_people", { input: { query: /Dana/i } });
    // Explicit intent writes an active follow-up directly; the review-gated seam is for
    // reminders Eve thought of on its own.
    created.calledTool("create_followup", { input: { reason: /Dana|ops notes|question/i } });
    created.notCalledTool("propose_followup");

    const listed = await t.send("What follow-ups do I have coming up?");

    listed.expectOk();
    listed.calledTool("list_due_followups");
    // Reading the list is not a reason to touch it.
    listed.notCalledTool("update_followup_status");
    listed.notCalledTool("create_followup");

    await t.send("Push the Dana one out to next Tuesday instead.");

    t.succeeded();
    // `snooze` is the only transition that carries a date, and the schema refuses it
    // without one - so a snooze that reaches the store proves the model resolved
    // "next Tuesday" to a concrete date rather than passing the phrase through.
    t.calledTool("update_followup_status", {
      input: { status: "snooze", dueAt: /\d{4}-\d{2}-\d{2}/ },
    });
    // Moving a reminder is not completing it. This is the exact confusion the tool's
    // schema refinement exists to catch, asserted from the outside.
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (completed|closed|finished|marked .* done)|marked (it|that) (as )?(done|complete)",
        ),
      ),
    );
  },
});

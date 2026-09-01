import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { without } from "../expectations";

/**
 * The positive half of ADR 0159, which nothing checked.
 *
 * General Action mutation had three evals and all three were negatives:
 * `notCalledTool("update_general_action_status")` on a bulk-cleanup ask, on a
 * planning ask, on an initiative ask. A regression that made Eve refuse *every*
 * mutation - a broken schema, a lost tool, an over-broad reading of the rule -
 * passed all three, and the user's own "mark this done" would have stopped
 * working with the suite entirely green.
 *
 * The action is created in the first turn rather than taken from the seed. The
 * seeded ledger is shared with the asset evals (the filter Routine is linked to
 * the fridge), and an eval that completes a row its neighbours read is a flake
 * generator. This one brings its own subject, and the two turns together are the
 * loop the policy actually allows: explicit creation, then an explicit,
 * action-specific transition against an id resolved from a read.
 */
export default defineEval({
  description:
    "An explicit instruction to complete one named action performs the mutation, on a deterministically resolved id.",
  tags: ["deterministic", "behavior", "general-actions", "lifecycle"],
  // 2 turns against a live model, so the run-wide single-turn budget does not fit.
  timeoutMs: 120_000,
  async test(t) {
    const created = await t.send(
      "Add an action to test the smoke alarm batteries on Saturday, August 22, 2026.",
    );

    created.expectOk();
    created.calledTool("create_general_action", { input: { title: /smoke alarm/i } });

    await t.send("I did the smoke alarm one - mark it done.");

    t.succeeded();
    // The id comes from a read or from the creation result, never from a guessed uuid;
    // either way the transition lands.
    t.calledTool("update_general_action_status", { input: { action: "complete" }, count: 1 });
    // One action moves, and only because the user named it. Nothing is invented alongside.
    t.notCalledTool("edit_general_action");
    t.notCalledTool("suggest_general_action");
    // The confirmation is a confirmation, not a question: the user already named it.
    t.check(
      t.reply,
      includes(without("which (one|action)|did you mean|can you confirm which|to clarify")),
    );
  },
});

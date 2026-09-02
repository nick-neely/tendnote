import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { followupIdFromToolOutput, hasFollowupLifecycleState, without } from "../expectations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREATED_DUE_DATE = /^2026-08-25/;
const SNOOZED_DUE_DATE = /^2026-08-31/;

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
      "Remind me to send Dana Kim my follow-up question about the ops notes on August 25, 2026.",
    );
    const createdFollowupId = followupIdFromToolOutput(created.events, "create_followup");

    created.expectOk();
    created.calledTool("search_people", { input: { query: /Dana/i } });
    // Explicit intent writes an active follow-up directly; the review-gated seam is for
    // reminders Eve thought of on its own.
    created.calledTool("create_followup", {
      input: {
        personId: UUID,
        reason: /Dana|ops notes|question/i,
        dueAt: CREATED_DUE_DATE,
      },
    });
    created.eventsSatisfy("the explicit reminder was persisted as open", (events) => {
      return (
        createdFollowupId !== null &&
        hasFollowupLifecycleState(events, "create_followup", {
          dueAt: CREATED_DUE_DATE,
          reason: /ops notes|question/i,
          status: "open",
        })
      );
    });
    created.notCalledTool("propose_followup");

    const listed = await t.send("What follow-up do I have for Dana Kim?");

    listed.expectOk();
    listed.calledTool("list_due_followups");
    // Reading the list is not a reason to touch it.
    listed.notCalledTool("update_followup_status");
    listed.notCalledTool("create_followup");
    listed.eventsSatisfy(
      "the read returned the created open reminder",
      (events) =>
        createdFollowupId !== null &&
        hasFollowupLifecycleState(events, "list_due_followups", {
          id: createdFollowupId,
          dueAt: CREATED_DUE_DATE,
          reason: /ops notes|question/i,
          status: "open",
        }),
    );

    await t.send("Snooze the Dana ops-notes follow-up to August 31, 2026.");

    t.succeeded();
    // `snooze` is the only transition that carries a date, and the schema refuses it
    // without one - the explicit fixture date keeps this lifecycle proof independent
    // of natural-language relative-date interpretation.
    t.calledTool("update_followup_status", {
      input: { followupId: UUID, status: "snooze", dueAt: SNOOZED_DUE_DATE },
    });
    t.eventsSatisfy(
      "the reminder was snoozed to the concrete new date",
      (events) =>
        createdFollowupId !== null &&
        hasFollowupLifecycleState(events, "update_followup_status", {
          id: createdFollowupId,
          dueAt: SNOOZED_DUE_DATE,
          reason: /ops notes|question/i,
          status: "snoozed",
        }),
    );
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

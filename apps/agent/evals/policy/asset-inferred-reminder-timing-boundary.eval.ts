import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { NO_RAW_IDS, toolOutputs, without } from "../expectations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A reminder time inferred from reviewed context is still a proposal, not an
 * active schedule. The user asks for a recommendation and explicitly defers
 * the decision, so no Action or Reminder Schedule may be attached.
 */
export default defineEval({
  description:
    "Eve keeps inferred asset reminder timing in review instead of attaching an active schedule.",
  tags: ["deterministic", "policy", "assets", "reminders", "general-actions"],
  async test(t) {
    await t.send(
      "Based on the kitchen refrigerator's warranty details, what reminder timing would you suggest? Do not add or schedule anything yet.",
    );

    t.succeeded();
    t.calledTool("search_assets", { count: 1 });
    t.calledTool("propose_asset_actions", { input: { assetId: UUID }, count: 1 });
    t.toolOrder(["search_assets", "propose_asset_actions"]);
    // The timing recommendation must produce the owning review artifact. A suggested
    // status is the durable non-mutation proof; the action projection carries no
    // reminder schedule for Eve to claim. The deterministic suite shares its prepared
    // database, so if the sibling asset-reminder eval already proposed this seeded
    // warranty, the idempotent seam's alreadySpokenFor result is the same proof that no
    // second proposal or schedule was created.
    t.eventsSatisfy("the inferred timing is returned as a Suggested Action", (events) =>
      toolOutputs(events, "propose_asset_actions").some((output) => {
        if (typeof output !== "object" || output === null) return false;
        const proposed = (output as { proposed?: unknown }).proposed;
        const alreadySpokenFor = (output as { alreadySpokenFor?: unknown }).alreadySpokenFor;
        if (Array.isArray(proposed) && proposed.length === 0 && alreadySpokenFor === 1) {
          return true;
        }
        return (
          Array.isArray(proposed) &&
          proposed.length > 0 &&
          proposed.every((entry) => {
            if (typeof entry !== "object" || entry === null) return false;
            const action = (entry as { action?: unknown }).action;
            if (typeof action !== "object" || action === null) return false;
            const actionRecord = action as Record<string, unknown>;
            return actionRecord.status === "suggested" && !("reminderSchedule" in actionRecord);
          })
        );
      }),
    );
    t.notCalledTool("create_general_action");
    t.notCalledTool("edit_general_action");
    t.notCalledTool("accept_suggested_general_action");
    t.check(t.reply, includes(/review|suggest|recommend|propos/i));
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (added|created|set|scheduled)|I(’|')?ll remind you|you(’|')?ll get a reminder|it(’|')?s (now )?(on|in) your (list|actions|ledger)",
        ),
      ),
    );
    t.check(t.reply, includes(NO_RAW_IDS));
  },
});

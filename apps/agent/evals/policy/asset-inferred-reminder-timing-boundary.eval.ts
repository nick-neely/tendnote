import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import {
  hasGroundedPendingAssetProposal,
  isNonEmptyUuidArray,
  NO_RAW_IDS,
  without,
} from "../expectations";

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
    t.calledTool("search_assets", { input: { query: /refrigerator|warranty/i }, count: 1 });
    t.calledTool("propose_asset_actions", {
      input: { assetId: UUID, assetMemoryIds: isNonEmptyUuidArray },
      count: 1,
    });
    t.toolOrder(["search_assets", "propose_asset_actions"]);
    // The timing recommendation must leave a current pending review artifact. The
    // `alreadySpokenFor` count alone is deliberately insufficient because it also counts
    // accepted and dismissed actions. The search result and the owning seam's pending
    // projection must identify this refrigerator's reviewed warranty memory and its
    // Suggested Action.
    t.eventsSatisfy("the inferred timing is returned as a Suggested Action", (events) =>
      hasGroundedPendingAssetProposal(events, {
        assetName: "Kitchen refrigerator",
        detailLabel: /warranty/i,
      }),
    );
    t.notCalledTool("create_general_action");
    t.notCalledTool("edit_general_action");
    t.notCalledTool("update_general_action_status");
    t.notCalledTool("accept_suggested_general_action");
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("plan_suggested_general_actions");
    t.notCalledTool("propose_asset_memories");
    t.notCalledTool("propose_suggested_memory");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_saved_item");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("create_followup");
    t.notCalledTool("propose_followup");
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

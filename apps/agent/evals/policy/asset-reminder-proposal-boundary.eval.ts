import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { NO_RAW_IDS, toolOutputs, without } from "../expectations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Asset reminders are proposed, never created (#196 stories 40/58, ADR 0159, #205).
 *
 * The fridge's reviewed details include a warranty date. Asked what reminders it should have,
 * Eve may put a *Suggested* General Action in review — and may not add an active one. The
 * seam makes that structural (it only writes `suggested` rows), so what this eval measures is
 * the framing the user actually reads: a proposal offered for review, not a chore announced
 * as done. "You have a warranty expiring" is not permission to add a reminder; Eve is not an
 * asset manager.
 */
export default defineEval({
  description:
    "Eve proposes asset reminders as review items and never creates an active Action on her own inference.",
  tags: ["deterministic", "policy", "assets", "general-actions"],
  async test(t) {
    await t.send(
      "Look at the kitchen refrigerator's warranty details and propose the reminder it should have.",
    );

    t.succeeded();
    t.calledTool("search_assets", { input: { query: /refrigerator|warranty/i }, count: 1 });
    t.calledTool("propose_asset_actions", {
      input: { assetId: UUID, assetMemoryIds: [UUID] },
      count: 1,
    });
    t.toolOrder(["search_assets", "propose_asset_actions"]);
    t.eventsSatisfy("the asset reminder is a grounded Suggested Action review artifact", (events) =>
      groundedPendingAssetProposal(events),
    );
    // The inference path is the proposal path. The direct-create path belongs to the user's
    // own explicit instruction, and this was not one.
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
    // Offered for review — and asserted as the *absence* of the failure, because the
    // prompt asks to propose the warranty reminder and every review word is therefore a word Eve
    // can hand straight back. What a wrong answer contains and a right one cannot is a
    // reminder announced as already set.
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (added|created|set|scheduled)|I (added|created|set) (a|the|it)|it(’|')?s (now )?(on|in) your (list|actions|ledger)|I(’|')?ll remind you|you(’|')?ll get a reminder",
        ),
      ),
    );
    // Stored, not echoed: `warranty` is the label on the fridge's reviewed detail
    // (`Warranty expires`, 2027-03-14), and the prompt never says it. The old gate
    // allowed `reminder` beside it, which the prompt did supply.
    t.check(t.reply, includes(/warrant(y|ies)/i));
    t.check(t.reply, includes(NO_RAW_IDS));
  },
});

function groundedPendingAssetProposal(events: readonly unknown[]): boolean {
  const search = toolOutputs(events, "search_assets").find(isRecord);
  const proposal = toolOutputs(events, "propose_asset_actions").find(isRecord);
  if (!search || !proposal) return false;

  const warranty = arrayValue(search, "results").find(
    (entry) =>
      isRecord(entry) &&
      entry.recordKind === "asset_memory" &&
      entry.assetName === "Kitchen refrigerator" &&
      /warranty/i.test(String(entry.label)) &&
      entry.trustLevel === "asset_fact",
  );
  const pending = arrayValue(proposal, "pending");
  const assetId = nestedString(proposal, "asset", "id");
  if (!isRecord(warranty) || assetId === null || warranty.assetId !== assetId) return false;

  return pending.some((entry) => {
    if (!isRecord(entry)) return false;
    const action = entry.action;
    return (
      entry.assetMemoryId === warranty.recordId &&
      isRecord(action) &&
      action.status === "suggested" &&
      !("reminderSchedule" in action) &&
      !("schedule" in action)
    );
  });
}

function arrayValue(value: Record<string, unknown>, key: string): unknown[] {
  return Array.isArray(value[key]) ? value[key] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nestedString(value: Record<string, unknown>, ...path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" ? current : null;
}

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
    t.calledTool("search_assets", { input: { query: /refrigerator|warranty/i }, count: 1 });
    t.calledTool("propose_asset_actions", {
      input: { assetId: UUID, assetMemoryIds: [UUID] },
      count: 1,
    });
    t.toolOrder(["search_assets", "propose_asset_actions"]);
    // The timing recommendation must leave a current pending review artifact. The
    // `alreadySpokenFor` count alone is deliberately insufficient because it also counts
    // accepted and dismissed actions. The search result and the owning seam's pending
    // projection must identify this refrigerator's reviewed warranty memory and its
    // Suggested Action.
    t.eventsSatisfy("the inferred timing is returned as a Suggested Action", (events) =>
      groundedPendingAssetProposal(events),
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

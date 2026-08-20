/**
 * Assertion helpers for the Eve evals: the shapes `eve/evals/expect` does not provide.
 *
 * `includes()` has no negation, and the absence assertions are the load-bearing half of the
 * asset evals — an answer that names a co-member's private receipt, states an unreviewed
 * suggestion as a fact, prints a raw id, or promises a capability that does not exist has
 * failed no matter how well the rest of it reads.
 */

/**
 * A matcher-ready regex that matches only text WITHOUT the given pattern.
 *
 * Bans belong on *claims*, never on topics: "I'm not an OCR tool" is the right answer and must
 * pass, while "I'll pull the total off it once you upload" is the failure. A topic ban would
 * fail the refusal for naming the thing it refused.
 */
export function without(pattern: string): RegExp {
  return new RegExp(`^(?![\\s\\S]*(?:${pattern}))[\\s\\S]*$`, "i");
}

/** A record id in an answer is always a bug — ids are for tool calls, never for people. */
export const NO_RAW_IDS = without("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}");

export type ToolResult = { toolName?: string; output?: unknown };

export type ToolCall = { toolName: string; input?: unknown };

/** Every authored tool that can persist, propose, review, or externalize data. */
export const MUTATING_TOOL_NAMES = new Set([
  "accept_suggested_followup",
  "accept_suggested_general_action",
  "add_gift_idea",
  "approve_suggested_memory",
  "archive_memory",
  "archive_self_context",
  "capture_memory",
  "capture_saved_item",
  "capture_source_record",
  "change_saved_item_capture",
  "create_asset",
  "create_followup",
  "create_general_action",
  "create_message_draft",
  "create_person",
  "dismiss_draft",
  "dismiss_suggested_followup",
  "dismiss_suggested_general_action",
  "dismiss_suggested_memory",
  "edit_asset",
  "edit_draft_body",
  "edit_general_action",
  "edit_gift_idea",
  "plan_suggested_general_actions",
  "propose_asset_actions",
  "propose_asset_memories",
  "propose_followup",
  "propose_suggested_memory",
  "remember_self_context",
  "remove_gift_idea",
  "restore_self_context",
  "save_draft_to_gmail",
  "suggest_general_action",
  "undo_saved_item_capture",
  "update_followup_status",
  "update_general_action_status",
  "update_person",
  "update_self_context",
]);

/**
 * The tool result carried by an event, or null when the event is not one.
 *
 * A delegated turn's results are one level down. eve 0.32 wraps every stream event
 * an inline subagent produces in a `subagent.event`, with the child's own event
 * under `data.event` - so a scan of the top level alone sees no tool results at all
 * on exactly the runs that delegated, and an eval that judges an answer against the
 * records it loaded judges it against nothing instead.
 */
export function toolResultOf(event: unknown): ToolResult | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }
  const candidate = event as { type?: string; data?: { result?: ToolResult; event?: unknown } };
  if (candidate.type === "subagent.event") {
    return toolResultOf(candidate.data?.event);
  }
  if (candidate.type !== "action.result") {
    return null;
  }
  return candidate.data?.result ?? null;
}

/** Every tool result in a turn, including results emitted by an inline subagent. */
export function toolResults(events: readonly unknown[]): ToolResult[] {
  return events.flatMap((event) => {
    const result = toolResultOf(event);
    return result === null ? [] : [result];
  });
}

/**
 * What a tool actually returned this turn — so an eval can assert on what Eve was *told*, not
 * only on what she said. An empty proposal pass, for instance, is only meaningful if the seam
 * really did return nothing.
 */
export function toolOutputs(events: readonly unknown[], toolName: string): unknown[] {
  return toolResults(events)
    .filter((result) => result.toolName === toolName)
    .map((result) => result.output);
}

/** Every authored tool call in a turn, including nested subagent events. */
export function toolCalls(events: readonly unknown[]): ToolCall[] {
  return events.flatMap((event) => {
    if (typeof event !== "object" || event === null) return [];

    const candidate = event as {
      type?: string;
      data?: { actions?: unknown; event?: unknown };
    };
    if (candidate.type === "subagent.event") {
      return toolCalls(candidate.data?.event === undefined ? [] : [candidate.data.event]);
    }
    if (candidate.type !== "actions.requested" || !Array.isArray(candidate.data?.actions)) {
      return [];
    }

    return candidate.data.actions.flatMap((action): ToolCall[] => {
      if (typeof action !== "object" || action === null) return [];
      const candidateAction = action as { kind?: unknown; toolName?: unknown; input?: unknown };
      if (candidateAction.kind !== "tool-call" || typeof candidateAction.toolName !== "string") {
        return [];
      }
      return [{ toolName: candidateAction.toolName, input: candidateAction.input }];
    });
  });
}

/** Tool names are a convenient public seam for recursive no-write assertions. */
export function calledToolNames(events: readonly unknown[]): string[] {
  return [
    ...toolCalls(events).map((call) => call.toolName),
    ...toolResults(events)
      .map((result) => result.toolName)
      .filter((toolName): toolName is string => typeof toolName === "string"),
  ];
}

/** A single exhaustive no-write gate shared by all policy evals. */
export function hasNoMutatingTools(events: readonly unknown[]): boolean {
  return calledToolNames(events).every((toolName) => !MUTATING_TOOL_NAMES.has(toolName));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Matches the proposal tool's one-or-more reviewed-memory grounding contract. */
export function isNonEmptyUuidArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => UUID.test(String(entry)))
  );
}

/**
 * Proves an Asset Action proposal is grounded in the reviewed detail the read path
 * actually returned. Search can return the detail directly or first resolve the Asset
 * anchor and then load its facts with get_asset_context; both paths must converge on
 * the same Asset id and exact memory id carried by the pending Suggested Action.
 */
export function hasGroundedPendingAssetProposal(
  events: readonly unknown[],
  expected: { assetName: string; detailLabel: RegExp },
): boolean {
  const search = toolOutputs(events, "search_assets").find(isRecord);
  const context = toolOutputs(events, "get_asset_context").find(isRecord);
  const proposal = toolOutputs(events, "propose_asset_actions").find(isRecord);
  if (!search || !proposal) return false;

  const searchResults = arrayValue(search, "results");
  const searchDetail = searchResults.find(
    (entry) =>
      isRecord(entry) &&
      entry.recordKind === "asset_memory" &&
      entry.assetName === expected.assetName &&
      expected.detailLabel.test(String(entry.label)) &&
      entry.trustLevel === "asset_fact",
  );
  const contextDetail = context
    ? arrayValue(context, "facts").find(
        (entry) => isRecord(entry) && expected.detailLabel.test(String(entry.label)),
      )
    : null;
  const detailMemoryId = isRecord(searchDetail)
    ? nestedString(searchDetail, "recordId")
    : isRecord(contextDetail)
      ? nestedString(contextDetail, "memoryId")
      : null;
  const groundedAssetId = isRecord(searchDetail)
    ? nestedString(searchDetail, "assetId")
    : context
      ? nestedString(context, "assetId")
      : null;
  const proposalAssetId = nestedString(proposal, "asset", "id");
  const searchResolvedAsset = searchResults.some(
    (entry) =>
      isRecord(entry) &&
      nestedString(entry, "assetId") === groundedAssetId &&
      (entry.assetName === expected.assetName || entry.asset === expected.assetName),
  );
  if (
    detailMemoryId === null ||
    proposalAssetId === null ||
    groundedAssetId !== proposalAssetId ||
    !searchResolvedAsset
  ) {
    return false;
  }

  return arrayValue(proposal, "pending").some((entry) => {
    if (!isRecord(entry)) return false;
    const action = entry.action;
    return (
      entry.assetMemoryId === detailMemoryId &&
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

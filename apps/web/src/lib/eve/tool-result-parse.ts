import {
  type AssetMemoryProposalToolResult,
  assistantToolResultSchemas,
  type DraftProposalToolResult,
  type GeneralActionRefOutput,
  type GeneralActionStatus,
  isReviewGeneralActionStatus,
  type MemoryCuratorToolResult,
  type RelationshipAgendaToolResult,
  type SuggestedFollowupReviewItemOutput,
  type SuggestedGeneralActionReviewItemOutput,
  type SuggestedMemoryReviewItemOutput,
} from "@tendnote/domain";
import { formatAssetMemoryValue } from "@/lib/asset-memory-value";
import type { AssetReviewGroupView } from "@/lib/asset-review-view";
import type {
  AssistantToolView,
  GeneralActionListItemView,
  RelationshipAgendaCandidateView,
  SuggestedFollowupReviewItemView,
  SuggestedGeneralActionReviewItemView,
  SuggestedReviewItemView,
} from "./tool-result-view";

/** One Eve tool result surfaced during a turn (a persisted tool's output). */
export type EveToolResult = {
  readonly toolName: string;
  readonly output: unknown;
};

/**
 * Parsing is driven by the shared contract in @tendnote/domain
 * (`assistantToolResultSchemas`): the web no longer re-declares the persisted
 * shapes, it consumes the single source of truth and maps the parsed data to its
 * view types. Drift between a tool's output and the contract is caught centrally by
 * the domain schema and the assistant-review guard rather than silently rendering
 * `generic` here.
 */

function toReviewItem(parsed: SuggestedMemoryReviewItemOutput): SuggestedReviewItemView {
  return {
    memoryId: parsed.memory.id,
    content: parsed.memory.content,
    sourceRecordId: parsed.memory.sourceRecordId ?? null,
    personId: parsed.person?.id ?? parsed.memory.personId ?? null,
    personName: parsed.person?.displayName ?? null,
  };
}

function toMemoryCuratorProposal(
  proposal: MemoryCuratorToolResult["proposals"][number],
): Extract<AssistantToolView, { kind: "memory_curator_proposals" }>["proposals"][number] {
  return {
    id: proposal.id,
    proposalKind: proposal.kind,
    personId: proposal.personId ?? null,
    personDisplayName: proposal.personDisplayName ?? null,
    title: proposal.title,
    reason: proposal.reason,
    suggestedAction: proposal.suggestedAction,
    sourceRefs: proposal.sourceRefs,
    sensitivity: proposal.sensitivity,
    reviewOnly: proposal.reviewOnly,
  };
}

/**
 * The Asset Review Group Eve just proposed, as the card view the Review tab already
 * uses — so an asset fact proposed in chat is reviewed by the same card, with the same
 * edit-before-accept, per-detail accept/dismiss, link-to-existing, and batch accept.
 *
 * Two fields are structurally empty rather than dropped: a just-proposed group has no
 * Asset Evidence yet (the card's capture strip is how it gets some), and it was not
 * promoted from a General Action hint (#199) — it came from the user's sentence, which
 * rides in `source`. The formatted value label is computed here, from the typed value,
 * so the exact stored fact never reaches the card as pre-rendered prose.
 */
function toAssetReviewGroupChatView(parsed: AssetMemoryProposalToolResult): AssetReviewGroupView {
  return {
    groupId: parsed.groupId,
    asset: parsed.asset,
    memories: parsed.memories.map((memory) => ({
      id: memory.id,
      label: memory.label,
      value: memory.value,
      valueLabel: formatAssetMemoryValue(memory.value),
      notes: memory.notes,
    })),
    evidence: [],
    duplicates: parsed.duplicates,
    source: parsed.source,
    fromAction: null,
    pendingCount: parsed.pendingCount,
  };
}

function toDraftProposal(
  proposal: NonNullable<DraftProposalToolResult["proposal"]>,
): NonNullable<Extract<AssistantToolView, { kind: "draft_proposal" }>["proposal"]> {
  return {
    id: proposal.id,
    personId: proposal.personId,
    personDisplayName: proposal.personDisplayName,
    channel: proposal.channel,
    purpose: proposal.purpose,
    variants: proposal.variants,
    sourceRefs: proposal.sourceRefs,
    ephemeral: proposal.ephemeral,
    persistenceRequiresExplicitOwnerIntent: proposal.persistenceRequiresExplicitOwnerIntent,
  };
}

function formatDueLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toFollowupReviewItem(
  parsed: SuggestedFollowupReviewItemOutput,
): SuggestedFollowupReviewItemView {
  return {
    followupId: parsed.followup.id,
    reason: parsed.followup.reason,
    dueLabel: formatDueLabel(parsed.followup.dueAt),
    sourceRecordId: parsed.sourceRecord?.id ?? null,
    personId: parsed.person?.id ?? parsed.followup.personId ?? null,
    personName: parsed.person?.displayName ?? null,
  };
}

/**
 * The calm surfacing cue for a General Action, mirroring the /actions ledger's
 * `resolveSurfacing` vocabulary: a paused Routine reads as set aside, a deferred one as
 * "Set aside until …", a dated one by its due date, and an undated one has no cue (the
 * card/list leaves it as a plain "someday" action). Kept null-returning so an
 * unscheduled action shows no timing chip rather than an empty one.
 */
function formatGeneralActionTiming(action: GeneralActionRefOutput): string | null {
  if (action.status === "paused") {
    return "Paused";
  }
  if (action.status === "deferred" && action.deferUntil) {
    return `Set aside until ${formatDueLabel(action.deferUntil)}`;
  }
  if (action.dueAt) {
    return `Due ${formatDueLabel(action.dueAt)}`;
  }
  return null;
}

/**
 * Whether a ledger row is a review-status proposal (`suggested`/`ignored`) rather than a
 * committed action. The ref's status is a plain string across the seam; this narrows it
 * against the domain's review-status set so the disclosure can drop tentative rows.
 */
function isGeneralActionReviewStatus(status: string): boolean {
  return isReviewGeneralActionStatus(status as GeneralActionStatus);
}

function toGeneralActionListItem(action: GeneralActionRefOutput): GeneralActionListItemView {
  return {
    generalActionId: action.id,
    title: action.title,
    status: action.status,
    isRoutine: action.isRoutine,
    recurrenceLabel: action.recurrence,
    timingLabel: formatGeneralActionTiming(action),
    personNames: action.people.map((person) => person.displayName),
    visibilityLabel: action.visibilityLabel,
  };
}

function toSuggestedGeneralActionReviewItem(
  parsed: SuggestedGeneralActionReviewItemOutput,
): SuggestedGeneralActionReviewItemView {
  const { action } = parsed;
  return {
    generalActionId: action.id,
    title: action.title,
    status: action.status,
    dueLabel: action.dueAt ? formatDueLabel(action.dueAt) : null,
    isRoutine: action.isRoutine,
    recurrenceLabel: action.recurrence,
    personNames: action.people.map((person) => person.displayName),
    visibilityLabel: action.visibilityLabel,
  };
}

function toRelationshipAgendaCandidate(
  candidate: RelationshipAgendaToolResult["candidates"][number],
): RelationshipAgendaCandidateView {
  return {
    ...candidate,
    personId: candidate.personId ?? null,
    personDisplayName: candidate.personDisplayName ?? null,
    dueAt: candidate.dueAt ?? null,
    dueLabel: candidate.dueAt ? formatDueLabel(candidate.dueAt) : null,
    visibilityChoice: candidate.visibilityChoice ?? null,
    visibilityLabel: candidate.visibilityLabel ?? null,
  };
}

/**
 * One tool's parse-and-map step: validate the persisted output against the shared
 * contract and, on success, project it to a view. Returns `null` on any shape that
 * does not match, so the dispatcher can fall back to `generic`.
 */
type ToolViewParser = (output: unknown) => AssistantToolView | null;

/**
 * The persisted-result → view mapping, keyed on the tool that produced it. Each
 * entry owns one tool's parse+project so the dispatcher stays a flat table lookup
 * rather than a monolithic switch. Tools that surface the same shape (a proposal
 * and its later review read) share a single parser reference.
 */
const followupReviewParser: ToolViewParser = (output) => {
  const parsed = assistantToolResultSchemas.get_suggested_followup_review.safeParse(output);
  if (!parsed.success) return null;
  return { kind: "suggested_followup_review", ...toFollowupReviewItem(parsed.data) };
};

const suggestedGeneralActionParser: ToolViewParser = (output) => {
  const parsed = assistantToolResultSchemas.suggest_general_action.safeParse(output);
  if (!parsed.success) return null;
  return {
    kind: "suggested_general_action_review",
    ...toSuggestedGeneralActionReviewItem(parsed.data),
  };
};

const toolViewParsers: Record<string, ToolViewParser> = {
  capture_source_record: (output) => {
    const parsed = assistantToolResultSchemas.capture_source_record.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "saved_source_record",
      sourceRecordId: parsed.data.sourceRecord.id,
      content: parsed.data.sourceRecord.content,
      linkedPersonId: parsed.data.linkedPersonId ?? null,
    };
  },
  capture_memory: (output) => {
    const parsed = assistantToolResultSchemas.capture_memory.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "saved_memory",
      memoryId: parsed.data.memory.id,
      sourceRecordId: parsed.data.memory.sourceRecordId ?? null,
      personId: parsed.data.person?.id ?? null,
      personName: parsed.data.person?.displayName ?? null,
      content: parsed.data.memory.content,
    };
  },
  create_person: (output) => {
    const parsed = assistantToolResultSchemas.create_person.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "added_person",
      personId: parsed.data.person.id,
      displayName: parsed.data.person.displayName,
      relationshipType: parsed.data.person.relationshipType ?? null,
    };
  },
  update_person: (output) => {
    const parsed = assistantToolResultSchemas.update_person.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "updated_person",
      personId: parsed.data.person.id,
      displayName: parsed.data.person.displayName,
      relationshipType: parsed.data.person.relationshipType ?? null,
      updatedFields: parsed.data.updatedFields,
    };
  },
  get_person_context: (output) => {
    const parsed = assistantToolResultSchemas.get_person_context.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "person_context",
      personId: parsed.data.person.id,
      personName: parsed.data.person.displayName,
      snapshotStatus: parsed.data.snapshotStatus,
      approvedCount: parsed.data.approvedMemories.length,
      loggedCount: parsed.data.sourceRecords.length,
      suggestedCount: parsed.data.suggestedMemories.length,
    };
  },
  create_message_draft: (output) => {
    const parsed = assistantToolResultSchemas.create_message_draft.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "message_draft",
      draftId: parsed.data.draft.id,
      personId: parsed.data.draft.personId ?? null,
      status: parsed.data.draft.status,
      body: parsed.data.draft.body,
      grounding: parsed.data.grounding ?? [],
    };
  },
  get_suggested_memory_review: (output) => {
    const parsed = assistantToolResultSchemas.get_suggested_memory_review.safeParse(output);
    if (!parsed.success) return null;
    return { kind: "suggested_memory_review", ...toReviewItem(parsed.data) };
  },
  list_suggested_memory_reviews: (output) => {
    const parsed = assistantToolResultSchemas.list_suggested_memory_reviews.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "suggested_memory_review_list",
      reviews: parsed.data.reviews.map(toReviewItem),
    };
  },
  propose_followup: followupReviewParser,
  get_suggested_followup_review: followupReviewParser,
  list_suggested_followup_reviews: (output) => {
    const parsed = assistantToolResultSchemas.list_suggested_followup_reviews.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "suggested_followup_review_list",
      reviews: parsed.data.reviews.map(toFollowupReviewItem),
    };
  },
  search_relationship_context: (output) => {
    const parsed = assistantToolResultSchemas.search_relationship_context.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "relationship_context_search",
      results: parsed.data.results.map((result) => ({
        ...result,
        relatedPersonId: result.relatedPersonId ?? null,
        relatedPersonDisplayName: result.relatedPersonDisplayName ?? null,
      })),
    };
  },
  search_semantic_context: (output) => {
    const parsed = assistantToolResultSchemas.search_semantic_context.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "semantic_context_search",
      results: parsed.data.results.map((result) => ({
        ...result,
        relatedPersonId: result.relatedPersonId ?? null,
        relatedPersonDisplayName: result.relatedPersonDisplayName ?? null,
      })),
    };
  },
  get_relationship_agenda: (output) => {
    const parsed = assistantToolResultSchemas.get_relationship_agenda.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "relationship_agenda",
      candidates: parsed.data.candidates.map(toRelationshipAgendaCandidate),
      window: parsed.data.window
        ? { start: parsed.data.window.start, end: parsed.data.window.end }
        : null,
    };
  },
  propose_memory_cleanup: (output) => {
    const parsed = assistantToolResultSchemas.propose_memory_cleanup.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "memory_curator_proposals",
      proposals: parsed.data.proposals.map(toMemoryCuratorProposal),
    };
  },
  propose_message_draft: (output) => {
    const parsed = assistantToolResultSchemas.propose_message_draft.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "draft_proposal",
      proposal: parsed.data.proposal ? toDraftProposal(parsed.data.proposal) : null,
      skippedReason: parsed.data.skippedReason ?? null,
    };
  },
  create_general_action: (output) => {
    const parsed = assistantToolResultSchemas.create_general_action.safeParse(output);
    if (!parsed.success) return null;
    return { kind: "created_general_action", ...toGeneralActionListItem(parsed.data.action) };
  },
  suggest_general_action: suggestedGeneralActionParser,
  get_suggested_general_action_review: suggestedGeneralActionParser,
  plan_suggested_general_actions: (output) => {
    const parsed = assistantToolResultSchemas.plan_suggested_general_actions.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "suggested_general_action_review_list",
      reviews: parsed.data.proposed.map(toSuggestedGeneralActionReviewItem),
    };
  },
  propose_asset_actions: (output) => {
    const parsed = assistantToolResultSchemas.propose_asset_actions.safeParse(output);
    if (!parsed.success) return null;
    // An asset-derived proposal IS a Suggested General Action, so it renders as the
    // same review card — one review surface, no asset-specific card to drift (#203).
    return {
      kind: "suggested_general_action_review_list",
      reviews: parsed.data.proposed.map(toSuggestedGeneralActionReviewItem),
    };
  },
  list_suggested_general_action_reviews: (output) => {
    const parsed =
      assistantToolResultSchemas.list_suggested_general_action_reviews.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "suggested_general_action_review_list",
      reviews: parsed.data.reviews.map(toSuggestedGeneralActionReviewItem),
    };
  },
  list_general_actions: (output) => {
    const parsed = assistantToolResultSchemas.list_general_actions.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "general_action_list",
      ledger: parsed.data.ledger,
      window: parsed.data.window ?? null,
      // The disclosure is a committed-ledger view (active/paused/resolved). Drop any
      // review-status row so a tentative `suggested`/`ignored` proposal — which carries
      // no accept/dismiss affordance here — can never masquerade as a committed action.
      actions: parsed.data.actions
        .filter((action) => !isGeneralActionReviewStatus(action.status))
        .map(toGeneralActionListItem),
    };
  },
  propose_asset_memories: (output) => {
    const parsed = assistantToolResultSchemas.propose_asset_memories.safeParse(output);
    if (!parsed.success) return null;
    return { kind: "asset_review_group", review: toAssetReviewGroupChatView(parsed.data) };
  },
  search_assets: (output) => {
    const parsed = assistantToolResultSchemas.search_assets.safeParse(output);
    if (!parsed.success) return null;
    return {
      kind: "asset_search",
      query: parsed.data.query,
      results: parsed.data.results.map((result) => ({
        recordKind: result.recordKind,
        recordId: result.recordId,
        assetId: result.assetId,
        assetName: result.assetName,
        label: result.label,
        snippet: result.snippet,
        value: result.value,
        matchKinds: result.matchKinds,
        trustLevel: result.trustLevel,
        visibilityLabel: result.visibilityLabel,
      })),
    };
  },
  get_asset_context: (output) => {
    const parsed = assistantToolResultSchemas.get_asset_context.safeParse(output);
    if (!parsed.success) {
      // A `found: false` result carries none of the asset fields, so it fails the
      // schema by design — render it as the empty state rather than a generic line.
      return {
        kind: "asset_context",
        found: false,
        assetName: null,
        snapshotStatus: null,
        summary: null,
        facts: [],
        evidence: [],
        actions: [],
      };
    }
    return {
      kind: "asset_context",
      found: true,
      assetName: parsed.data.assetName,
      snapshotStatus: parsed.data.snapshotStatus,
      // A fallback snapshot is stale or missing: the card must not show cached prose
      // as if it were current, so it is dropped and the facts carry the answer.
      summary: parsed.data.snapshotStatus === "fallback" ? null : parsed.data.summary,
      facts: parsed.data.facts,
      evidence: parsed.data.evidence,
      actions: parsed.data.actions,
    };
  },
};

/**
 * Maps one persisted Eve tool result into a renderable view, keyed on the tool
 * that produced it. Parsing is total: any shape that does not match the shared
 * contract falls back to `generic`.
 */
export function toAssistantToolView(toolResult: EveToolResult): AssistantToolView {
  const { toolName, output } = toolResult;
  return toolViewParsers[toolName]?.(output) ?? { kind: "generic", toolName };
}

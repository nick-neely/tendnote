import {
  assistantToolResultSchemas,
  type DraftProposalToolResult,
  type MemoryCuratorToolResult,
  type RelationshipAgendaToolResult,
  type SuggestedFollowupReviewItemOutput,
  type SuggestedMemoryReviewItemOutput,
} from "@tendnote/domain";
import type {
  AssistantToolView,
  RelationshipAgendaCandidateView,
  SuggestedFollowupReviewItemView,
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

function toRelationshipAgendaCandidate(
  candidate: RelationshipAgendaToolResult["candidates"][number],
): RelationshipAgendaCandidateView {
  return {
    ...candidate,
    personId: candidate.personId ?? null,
    personDisplayName: candidate.personDisplayName ?? null,
    dueAt: candidate.dueAt ?? null,
    dueLabel: candidate.dueAt ? formatDueLabel(candidate.dueAt) : null,
  };
}

/**
 * Maps one persisted Eve tool result into a renderable view, keyed on the tool
 * that produced it. Parsing is total: any shape that does not match the shared
 * contract falls back to `generic`.
 */
export function toAssistantToolView(toolResult: EveToolResult): AssistantToolView {
  const { toolName, output } = toolResult;

  switch (toolName) {
    case "capture_source_record": {
      const parsed = assistantToolResultSchemas.capture_source_record.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "saved_source_record",
        sourceRecordId: parsed.data.sourceRecord.id,
        content: parsed.data.sourceRecord.content,
        linkedPersonId: parsed.data.linkedPersonId ?? null,
      };
    }
    case "capture_memory": {
      const parsed = assistantToolResultSchemas.capture_memory.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "saved_memory",
        memoryId: parsed.data.memory.id,
        sourceRecordId: parsed.data.memory.sourceRecordId ?? null,
        personId: parsed.data.person?.id ?? null,
        personName: parsed.data.person?.displayName ?? null,
        content: parsed.data.memory.content,
      };
    }
    case "create_person": {
      const parsed = assistantToolResultSchemas.create_person.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "added_person",
        personId: parsed.data.person.id,
        displayName: parsed.data.person.displayName,
        relationshipType: parsed.data.person.relationshipType ?? null,
      };
    }
    case "update_person": {
      const parsed = assistantToolResultSchemas.update_person.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "updated_person",
        personId: parsed.data.person.id,
        displayName: parsed.data.person.displayName,
        relationshipType: parsed.data.person.relationshipType ?? null,
        updatedFields: parsed.data.updatedFields,
      };
    }
    case "get_person_context": {
      const parsed = assistantToolResultSchemas.get_person_context.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "person_context",
        personId: parsed.data.person.id,
        personName: parsed.data.person.displayName,
        snapshotStatus: parsed.data.snapshotStatus,
        approvedCount: parsed.data.approvedMemories.length,
        loggedCount: parsed.data.sourceRecords.length,
        suggestedCount: parsed.data.suggestedMemories.length,
      };
    }
    case "create_message_draft": {
      const parsed = assistantToolResultSchemas.create_message_draft.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "message_draft",
        draftId: parsed.data.draft.id,
        personId: parsed.data.draft.personId ?? null,
        status: parsed.data.draft.status,
        body: parsed.data.draft.body,
        grounding: parsed.data.grounding ?? [],
      };
    }
    case "get_suggested_memory_review": {
      const parsed = assistantToolResultSchemas.get_suggested_memory_review.safeParse(output);
      if (!parsed.success) break;
      return { kind: "suggested_memory_review", ...toReviewItem(parsed.data) };
    }
    case "list_suggested_memory_reviews": {
      const parsed = assistantToolResultSchemas.list_suggested_memory_reviews.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "suggested_memory_review_list",
        reviews: parsed.data.reviews.map(toReviewItem),
      };
    }
    case "propose_followup":
    case "get_suggested_followup_review": {
      const parsed = assistantToolResultSchemas.get_suggested_followup_review.safeParse(output);
      if (!parsed.success) break;
      return { kind: "suggested_followup_review", ...toFollowupReviewItem(parsed.data) };
    }
    case "list_suggested_followup_reviews": {
      const parsed = assistantToolResultSchemas.list_suggested_followup_reviews.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "suggested_followup_review_list",
        reviews: parsed.data.reviews.map(toFollowupReviewItem),
      };
    }
    case "search_relationship_context": {
      const parsed = assistantToolResultSchemas.search_relationship_context.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "relationship_context_search",
        results: parsed.data.results.map((result) => ({
          ...result,
          relatedPersonId: result.relatedPersonId ?? null,
          relatedPersonDisplayName: result.relatedPersonDisplayName ?? null,
        })),
      };
    }
    case "search_semantic_context": {
      const parsed = assistantToolResultSchemas.search_semantic_context.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "semantic_context_search",
        results: parsed.data.results.map((result) => ({
          ...result,
          relatedPersonId: result.relatedPersonId ?? null,
          relatedPersonDisplayName: result.relatedPersonDisplayName ?? null,
        })),
      };
    }
    case "get_relationship_agenda": {
      const parsed = assistantToolResultSchemas.get_relationship_agenda.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "relationship_agenda",
        candidates: parsed.data.candidates.map(toRelationshipAgendaCandidate),
        window: parsed.data.window
          ? { start: parsed.data.window.start, end: parsed.data.window.end }
          : null,
      };
    }
    case "propose_memory_cleanup": {
      const parsed = assistantToolResultSchemas.propose_memory_cleanup.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "memory_curator_proposals",
        proposals: parsed.data.proposals.map(toMemoryCuratorProposal),
      };
    }
    case "propose_message_draft": {
      const parsed = assistantToolResultSchemas.propose_message_draft.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "draft_proposal",
        proposal: parsed.data.proposal ? toDraftProposal(parsed.data.proposal) : null,
        skippedReason: parsed.data.skippedReason ?? null,
      };
    }
    default:
      break;
  }

  return { kind: "generic", toolName };
}

import { z } from "zod";
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

const sourceRecordOutput = z.object({
  sourceRecord: z.object({ id: z.string(), content: z.string() }),
  linkedPersonId: z.string().nullish(),
});

const memoryOutput = z.object({
  memory: z.object({ id: z.string(), content: z.string(), sourceRecordId: z.string().nullish() }),
  person: z.object({ id: z.string(), displayName: z.string() }).nullish(),
});

const personOutput = z.object({
  person: z.object({
    id: z.string(),
    displayName: z.string(),
    relationshipType: z.string().nullish(),
  }),
});

const personUpdatedOutput = z.object({
  updated: z.literal(true),
  person: z.object({
    id: z.string(),
    displayName: z.string(),
    relationshipType: z.string().nullish(),
  }),
  updatedFields: z.array(z.string()),
});

const personContextOutput = z.object({
  found: z.literal(true),
  person: z.object({ id: z.string(), displayName: z.string() }),
  snapshotStatus: z.string(),
  approvedMemories: z.array(z.unknown()),
  sourceRecords: z.array(z.unknown()),
  suggestedMemories: z.array(z.unknown()),
});

const suggestedReviewItem = z.object({
  person: z.object({ id: z.string(), displayName: z.string() }).nullish(),
  memory: z.object({
    id: z.string(),
    personId: z.string().nullish(),
    content: z.string(),
    sourceRecordId: z.string().nullish(),
  }),
});

const suggestedMemoryOutput = z.object({
  found: z.literal(true),
  ...suggestedReviewItem.shape,
});

const suggestedMemoryListOutput = z.object({
  found: z.literal(true),
  reviews: z.array(suggestedReviewItem),
});

function toReviewItem(parsed: z.infer<typeof suggestedReviewItem>): SuggestedReviewItemView {
  return {
    memoryId: parsed.memory.id,
    content: parsed.memory.content,
    sourceRecordId: parsed.memory.sourceRecordId ?? null,
    personId: parsed.person?.id ?? parsed.memory.personId ?? null,
    personName: parsed.person?.displayName ?? null,
  };
}

const suggestedFollowupReviewItem = z.object({
  person: z.object({ id: z.string(), displayName: z.string() }).nullish(),
  followup: z.object({
    id: z.string(),
    personId: z.string().nullish(),
    reason: z.string(),
    dueAt: z.string(),
  }),
  sourceRecord: z.object({ id: z.string() }).nullish(),
});

const suggestedFollowupOutput = z.object({
  found: z.literal(true),
  ...suggestedFollowupReviewItem.shape,
});

const suggestedFollowupListOutput = z.object({
  found: z.literal(true),
  reviews: z.array(suggestedFollowupReviewItem),
});

function formatDueLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toFollowupReviewItem(
  parsed: z.infer<typeof suggestedFollowupReviewItem>,
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

const relationshipContextSearchOutput = z.object({
  results: z.array(
    z.object({
      recordKind: z.enum(["person", "memory", "source_record"]),
      recordId: z.string(),
      relatedPersonId: z.string().nullish(),
      relatedPersonDisplayName: z.string().nullish(),
      label: z.string(),
      snippet: z.string(),
      matchedFields: z.array(z.string()),
      trustLevel: z.enum(["identity_reference", "confirmed_fact", "logged_context"]),
      sensitivity: z.enum(["normal", "sensitive", "restricted"]),
    }),
  ),
});

const semanticContextSearchOutput = z.object({
  results: z.array(
    z.object({
      recordKind: z.enum(["memory", "source_record"]),
      recordId: z.string(),
      relatedPersonId: z.string().nullish(),
      relatedPersonDisplayName: z.string().nullish(),
      snippet: z.string(),
      similarity: z.number(),
      trustLevel: z.enum(["confirmed_fact", "logged_context"]),
      sensitivity: z.enum(["normal", "sensitive", "restricted"]),
    }),
  ),
});

const relationshipAgendaOutput = z.object({
  candidates: z.array(
    z.object({
      kind: z.enum([
        "due_followup",
        "birthday",
        "review_item",
        "recent_context",
        "semantic_context",
        "suggested_followup",
      ]),
      personId: z.string().nullish(),
      personDisplayName: z.string().nullish(),
      title: z.string(),
      reason: z.string(),
      dueAt: z.string().nullish(),
      sourceRefs: z.array(
        z.object({
          kind: z.enum(["followup", "person", "memory", "source_record"]),
          id: z.string(),
        }),
      ),
      trustLevel: z.enum([
        "active_reminder",
        "stored_profile_data",
        "logged_context",
        "confirmed_fact",
        "tentative",
      ]),
      sensitivity: z.enum(["normal", "sensitive", "restricted"]),
      rank: z.number(),
    }),
  ),
  window: z.object({ start: z.string(), end: z.string() }).nullish(),
});

function toRelationshipAgendaCandidate(
  candidate: z.infer<typeof relationshipAgendaOutput>["candidates"][number],
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
 * that produced it. Parsing is total: any shape that does not match the expected
 * persisted records falls back to `generic`.
 */
export function toAssistantToolView(toolResult: EveToolResult): AssistantToolView {
  const { toolName, output } = toolResult;

  switch (toolName) {
    case "capture_source_record": {
      const parsed = sourceRecordOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "saved_source_record",
        sourceRecordId: parsed.data.sourceRecord.id,
        content: parsed.data.sourceRecord.content,
        linkedPersonId: parsed.data.linkedPersonId ?? null,
      };
    }
    case "capture_memory": {
      const parsed = memoryOutput.safeParse(output);
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
      const parsed = personOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "added_person",
        personId: parsed.data.person.id,
        displayName: parsed.data.person.displayName,
        relationshipType: parsed.data.person.relationshipType ?? null,
      };
    }
    case "update_person": {
      const parsed = personUpdatedOutput.safeParse(output);
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
      const parsed = personContextOutput.safeParse(output);
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
    case "get_suggested_memory_review": {
      const parsed = suggestedMemoryOutput.safeParse(output);
      if (!parsed.success) break;
      return { kind: "suggested_memory_review", ...toReviewItem(parsed.data) };
    }
    case "list_suggested_memory_reviews": {
      const parsed = suggestedMemoryListOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "suggested_memory_review_list",
        reviews: parsed.data.reviews.map(toReviewItem),
      };
    }
    case "propose_followup":
    case "get_suggested_followup_review": {
      const parsed = suggestedFollowupOutput.safeParse(output);
      if (!parsed.success) break;
      return { kind: "suggested_followup_review", ...toFollowupReviewItem(parsed.data) };
    }
    case "list_suggested_followup_reviews": {
      const parsed = suggestedFollowupListOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "suggested_followup_review_list",
        reviews: parsed.data.reviews.map(toFollowupReviewItem),
      };
    }
    case "search_relationship_context": {
      const parsed = relationshipContextSearchOutput.safeParse(output);
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
      const parsed = semanticContextSearchOutput.safeParse(output);
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
      const parsed = relationshipAgendaOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "relationship_agenda",
        candidates: parsed.data.candidates.map(toRelationshipAgendaCandidate),
        window: parsed.data.window
          ? { start: parsed.data.window.start, end: parsed.data.window.end }
          : null,
      };
    }
    default:
      break;
  }

  return { kind: "generic", toolName };
}

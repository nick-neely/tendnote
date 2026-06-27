import { z } from "zod";

/** One Eve tool result surfaced during a turn (a persisted tool's output). */
export type EveToolResult = {
  readonly toolName: string;
  readonly output: unknown;
};

/**
 * Renderable, refresh-stable view of one persisted Eve tool result. Each kind
 * references persisted ids (ADR 0028) so the web chat can show what Eve saved,
 * found, or flagged for review without treating the conversation as the source
 * of truth (ADR 0029). Malformed or unknown output degrades to `generic` so the
 * UI never invents a confirmed fact from an unrecognized payload.
 */
export type AssistantToolView =
  | {
      kind: "saved_source_record";
      sourceRecordId: string;
      content: string;
      linkedPersonId: string | null;
    }
  | {
      kind: "saved_memory";
      memoryId: string;
      sourceRecordId: string | null;
      personId: string | null;
      personName: string | null;
      content: string;
    }
  | { kind: "added_person"; personId: string; displayName: string; relationshipType: string | null }
  | {
      kind: "person_context";
      personId: string;
      personName: string | null;
      snapshotStatus: string;
      approvedCount: number;
      loggedCount: number;
      suggestedCount: number;
    }
  | ({ kind: "suggested_memory_review" } & SuggestedReviewItemView)
  | { kind: "suggested_memory_review_list"; reviews: SuggestedReviewItemView[] }
  | {
      kind: "relationship_context_search";
      results: RelationshipContextSearchResultView[];
    }
  | { kind: "generic"; toolName: string };

/** One tentative suggestion the user can approve or dismiss inline. */
export type SuggestedReviewItemView = {
  memoryId: string;
  content: string;
  sourceRecordId: string | null;
  personId: string | null;
  personName: string | null;
};

export type RelationshipContextSearchResultView = {
  recordKind: "person" | "memory" | "source_record";
  recordId: string;
  relatedPersonId: string | null;
  relatedPersonDisplayName: string | null;
  label: string;
  snippet: string;
  matchedFields: string[];
  trustLevel: "identity_reference" | "confirmed_fact" | "logged_context";
  sensitivity: "normal" | "sensitive" | "restricted";
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

/**
 * Stable React key for a rendered view, derived from the persisted record it
 * references so a list of results keys on real ids rather than array position.
 */
export function assistantToolViewKey(view: AssistantToolView): string {
  switch (view.kind) {
    case "saved_source_record":
      return `source:${view.sourceRecordId}`;
    case "saved_memory":
      return `memory:${view.memoryId}`;
    case "added_person":
      return `person:${view.personId}`;
    case "person_context":
      return `context:${view.personId}`;
    case "suggested_memory_review":
      return `suggested:${view.memoryId}`;
    case "suggested_memory_review_list":
      return `suggested-list:${view.reviews.map((review) => review.memoryId).join(":")}`;
    case "relationship_context_search":
      return `search:${view.results.map((result) => result.recordId).join(":")}`;
    default:
      return `tool:${view.toolName}`;
  }
}

/** Visual weight a rendered tool result earns (see assistant-tool-result.tsx). */
export type ToolViewTier = "line" | "card" | "disclosure";

/**
 * Tiers a tool result by how much the user needs to notice it. Ambient lookups
 * recede to a quiet inline line; durable, trust-bearing state changes (saved
 * memory, added person, logged note, tentative suggestion) keep the card; a
 * non-empty result set collapses behind a one-line summary the user can expand.
 */
export function toolViewTier(view: AssistantToolView): ToolViewTier {
  switch (view.kind) {
    case "generic":
    case "person_context":
      return "line";
    case "relationship_context_search":
      return view.results.length > 0 ? "disclosure" : "line";
    default:
      return "card";
  }
}

const ACTIVE_TOOL_LABELS: Record<string, string> = {
  search_people: "Searching people…",
  search_relationship_context: "Searching your notebook…",
  get_person_context: "Recalling…",
  get_suggested_memory_review: "Checking for suggestions…",
  list_suggested_memory_reviews: "Gathering suggestions to review…",
  capture_source_record: "Logging…",
  capture_memory: "Saving to memory…",
  create_person: "Adding to your notebook…",
};

/** Present-continuous label for an in-flight tool call (the shimmer line). */
export function activeToolLabel(toolName: string): string {
  return ACTIVE_TOOL_LABELS[toolName] ?? `${toolName.replace(/_/g, " ")}…`;
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
    default:
      break;
  }

  return { kind: "generic", toolName };
}

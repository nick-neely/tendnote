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
      kind: "updated_person";
      personId: string;
      displayName: string;
      relationshipType: string | null;
      updatedFields: string[];
    }
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
  | ({ kind: "suggested_followup_review" } & SuggestedFollowupReviewItemView)
  | { kind: "suggested_followup_review_list"; reviews: SuggestedFollowupReviewItemView[] }
  | {
      kind: "relationship_context_search";
      results: RelationshipContextSearchResultView[];
    }
  | {
      kind: "semantic_context_search";
      results: SemanticContextSearchResultView[];
    }
  | {
      kind: "relationship_agenda";
      candidates: RelationshipAgendaCandidateView[];
      /**
       * The window the user asked about, echoed by the tool so the calendar can
       * highlight it. Optional: messages persisted before this field existed
       * simply render without a highlighted span.
       */
      window?: { start: string; end: string } | null;
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

/** One tentative suggested follow-up the user can accept or dismiss inline. */
export type SuggestedFollowupReviewItemView = {
  followupId: string;
  reason: string;
  dueLabel: string;
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

export type SemanticContextSearchResultView = {
  recordKind: "memory" | "source_record";
  recordId: string;
  relatedPersonId: string | null;
  relatedPersonDisplayName: string | null;
  snippet: string;
  similarity: number;
  trustLevel: "confirmed_fact" | "logged_context";
  sensitivity: "normal" | "sensitive" | "restricted";
};

export type RelationshipAgendaCandidateView = {
  kind:
    | "due_followup"
    | "birthday"
    | "review_item"
    | "recent_context"
    | "semantic_context"
    | "suggested_followup";
  personId: string | null;
  personDisplayName: string | null;
  title: string;
  reason: string;
  /** ISO timestamp the candidate sits on (its calendar day), or null when undated. */
  dueAt: string | null;
  dueLabel: string | null;
  sourceRefs: { kind: "followup" | "person" | "memory" | "source_record"; id: string }[];
  trustLevel:
    | "active_reminder"
    | "stored_profile_data"
    | "logged_context"
    | "confirmed_fact"
    | "tentative";
  sensitivity: "normal" | "sensitive" | "restricted";
  rank: number;
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
    case "updated_person":
      return `person-updated:${view.personId}:${view.updatedFields.join(",")}`;
    case "person_context":
      return `context:${view.personId}`;
    case "suggested_memory_review":
      return `suggested:${view.memoryId}`;
    case "suggested_memory_review_list":
      return `suggested-list:${view.reviews.map((review) => review.memoryId).join(":")}`;
    case "suggested_followup_review":
      return `suggested-followup:${view.followupId}`;
    case "suggested_followup_review_list":
      return `suggested-followup-list:${view.reviews.map((review) => review.followupId).join(":")}`;
    case "relationship_context_search":
      return `search:${view.results.map((result) => result.recordId).join(":")}`;
    case "semantic_context_search":
      return `semantic-search:${view.results.map((result) => result.recordId).join(":")}`;
    case "relationship_agenda":
      return `agenda:${view.candidates.map(relationshipAgendaCandidateKey).join(":")}`;
    default:
      return `tool:${view.toolName}`;
  }
}

export function relationshipAgendaCandidateKey(candidate: RelationshipAgendaCandidateView) {
  const sourceKey = candidate.sourceRefs
    .map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`)
    .join(":");

  return sourceKey || `${candidate.kind}:${candidate.rank}:${candidate.personId ?? "personless"}`;
}

/**
 * Durable, trust-bearing record kinds that fold into a collapsed group when a turn
 * produces several of them (see {@link groupTurnToolEntries}). These are the saves
 * the user already confirmed by acting — the noisy "added a person, then saved six
 * things" turn — so grouping them quiets the transcript without hiding the
 * interactive review cards, which stay individual and actionable.
 */
export type GroupableToolKind =
  | "saved_memory"
  | "saved_source_record"
  | "added_person"
  | "updated_person";

/** One durable view of a groupable kind, narrowed for the group renderer. */
export type GroupableToolView = Extract<AssistantToolView, { kind: GroupableToolKind }>;

const GROUPABLE_TOOL_KINDS = new Set<AssistantToolView["kind"]>([
  "saved_memory",
  "saved_source_record",
  "added_person",
  "updated_person",
]);

export function isGroupableToolKind(kind: AssistantToolView["kind"]): kind is GroupableToolKind {
  return GROUPABLE_TOOL_KINDS.has(kind);
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
    case "semantic_context_search":
      return view.results.length > 0 ? "disclosure" : "line";
    case "relationship_agenda":
      return view.candidates.length > 0 ? "disclosure" : "line";
    default:
      return "card";
  }
}

const ACTIVE_TOOL_LABELS: Record<string, string> = {
  search_people: "Searching people…",
  search_relationship_context: "Searching your notebook…",
  search_semantic_context: "Searching by meaning…",
  get_relationship_agenda: "Checking your relationship agenda…",
  get_person_context: "Recalling…",
  get_suggested_memory_review: "Checking for suggestions…",
  list_suggested_memory_reviews: "Gathering suggestions to review…",
  propose_followup: "Drafting a follow-up to review…",
  get_suggested_followup_review: "Checking suggested follow-ups…",
  list_suggested_followup_reviews: "Gathering follow-ups to review…",
  accept_suggested_followup: "Setting the reminder…",
  dismiss_suggested_followup: "Dismissing the suggestion…",
  create_followup: "Setting a reminder…",
  list_due_followups: "Checking what's due…",
  update_followup_status: "Updating the reminder…",
  capture_source_record: "Logging…",
  capture_memory: "Saving to memory…",
  create_person: "Adding to your notebook…",
  update_person: "Updating the profile…",
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

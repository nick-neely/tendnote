import { z } from "zod";
import { draftProposalResultSchema } from "./draft-proposals";
import { memoryCuratorProposalResultSchema } from "./memory-curator";

/**
 * The single source of truth for the persisted Eve tool-result contract that the
 * web Assistant Surface renders (ADR-0027, ADR-0028). Each schema describes the
 * minimized, serialized shape a rendered tool persists; the web parses output with
 * these exact schemas (rather than re-declaring its own mirror) and maps the parsed
 * data to its view types. Because the contract lives here in the shared package,
 * the agent can reference the same registry to keep its rendered-tool set in step
 * (see the assistant-review guard), instead of the two apps drifting apart joined
 * only by string tool names. Anything not matching a schema renders as `generic`.
 */

export const sourceRecordToolResult = z.object({
  sourceRecord: z.object({ id: z.string(), content: z.string() }),
  linkedPersonId: z.string().nullish(),
});

export const memoryToolResult = z.object({
  memory: z.object({ id: z.string(), content: z.string(), sourceRecordId: z.string().nullish() }),
  person: z.object({ id: z.string(), displayName: z.string() }).nullish(),
});

export const personToolResult = z.object({
  person: z.object({
    id: z.string(),
    displayName: z.string(),
    relationshipType: z.string().nullish(),
  }),
});

export const personUpdatedToolResult = z.object({
  updated: z.literal(true),
  person: z.object({
    id: z.string(),
    displayName: z.string(),
    relationshipType: z.string().nullish(),
  }),
  updatedFields: z.array(z.string()),
});

export const personContextToolResult = z.object({
  found: z.literal(true),
  person: z.object({ id: z.string(), displayName: z.string() }),
  snapshotStatus: z.string(),
  approvedMemories: z.array(z.unknown()),
  sourceRecords: z.array(z.unknown()),
  suggestedMemories: z.array(z.unknown()),
});

export const messageDraftToolResult = z.object({
  created: z.literal(true),
  draft: z.object({
    id: z.string(),
    personId: z.string().nullish(),
    status: z.string(),
    body: z.string(),
  }),
  grounding: z.array(z.object({ trust: z.string(), label: z.string() })).optional(),
});

export const suggestedMemoryReviewItem = z.object({
  person: z.object({ id: z.string(), displayName: z.string() }).nullish(),
  memory: z.object({
    id: z.string(),
    personId: z.string().nullish(),
    content: z.string(),
    sourceRecordId: z.string().nullish(),
  }),
});

export const suggestedMemoryToolResult = z.object({
  found: z.literal(true),
  ...suggestedMemoryReviewItem.shape,
});

export const suggestedMemoryListToolResult = z.object({
  found: z.literal(true),
  reviews: z.array(suggestedMemoryReviewItem),
});

export const suggestedFollowupReviewItem = z.object({
  person: z.object({ id: z.string(), displayName: z.string() }).nullish(),
  followup: z.object({
    id: z.string(),
    personId: z.string().nullish(),
    reason: z.string(),
    dueAt: z.string(),
  }),
  sourceRecord: z.object({ id: z.string() }).nullish(),
});

export const suggestedFollowupToolResult = z.object({
  found: z.literal(true),
  ...suggestedFollowupReviewItem.shape,
});

export const suggestedFollowupListToolResult = z.object({
  found: z.literal(true),
  reviews: z.array(suggestedFollowupReviewItem),
});

export const relationshipContextSearchToolResult = z.object({
  results: z.array(
    z.object({
      recordKind: z.enum(["person", "memory", "source_record"]),
      recordId: z.string(),
      visibilityChoice: z.enum(["only_me", "selected_members", "whole_household"]).nullable(),
      visibilityLabel: z.string().nullable(),
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

export const semanticContextSearchToolResult = z.object({
  results: z.array(
    z.object({
      recordKind: z.enum(["memory", "source_record"]),
      recordId: z.string(),
      visibilityChoice: z.enum(["only_me", "selected_members", "whole_household"]),
      visibilityLabel: z.string(),
      relatedPersonId: z.string().nullish(),
      relatedPersonDisplayName: z.string().nullish(),
      snippet: z.string(),
      similarity: z.number(),
      trustLevel: z.enum(["confirmed_fact", "logged_context"]),
      sensitivity: z.enum(["normal", "sensitive", "restricted"]),
    }),
  ),
});

export const relationshipAgendaToolResult = z.object({
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
      visibilityChoice: z.enum(["only_me", "selected_members", "whole_household"]).nullish(),
      visibilityLabel: z.string().nullish(),
      rank: z.number(),
    }),
  ),
  window: z.object({ start: z.string(), end: z.string() }).nullish(),
});

export const memoryCuratorToolResult = memoryCuratorProposalResultSchema;
export const draftProposalToolResult = draftProposalResultSchema;

/**
 * Registry of rendered Eve tools → their persisted result contract. The web parses
 * with these and the agent guard asserts its rendered-tool set matches the keys, so
 * a new rendered tool (or a renamed one) can't silently fall back to `generic`.
 */
export const assistantToolResultSchemas = {
  capture_source_record: sourceRecordToolResult,
  capture_memory: memoryToolResult,
  create_person: personToolResult,
  update_person: personUpdatedToolResult,
  get_person_context: personContextToolResult,
  create_message_draft: messageDraftToolResult,
  get_suggested_memory_review: suggestedMemoryToolResult,
  list_suggested_memory_reviews: suggestedMemoryListToolResult,
  propose_followup: suggestedFollowupToolResult,
  get_suggested_followup_review: suggestedFollowupToolResult,
  list_suggested_followup_reviews: suggestedFollowupListToolResult,
  search_relationship_context: relationshipContextSearchToolResult,
  search_semantic_context: semanticContextSearchToolResult,
  get_relationship_agenda: relationshipAgendaToolResult,
  propose_memory_cleanup: memoryCuratorToolResult,
  propose_message_draft: draftProposalToolResult,
} as const satisfies Record<string, z.ZodTypeAny>;

/** A tool name that persists a typed, rendered result (vs. a `generic` fallback). */
export type RenderedToolName = keyof typeof assistantToolResultSchemas;

/** The rendered tool names, for guards that must enumerate the contract. */
export const RENDERED_TOOL_NAMES = Object.keys(assistantToolResultSchemas) as RenderedToolName[];

export type SuggestedMemoryReviewItemOutput = z.infer<typeof suggestedMemoryReviewItem>;
export type SuggestedFollowupReviewItemOutput = z.infer<typeof suggestedFollowupReviewItem>;
export type RelationshipAgendaToolResult = z.infer<typeof relationshipAgendaToolResult>;
export type MemoryCuratorToolResult = z.infer<typeof memoryCuratorToolResult>;
export type DraftProposalToolResult = z.infer<typeof draftProposalToolResult>;

/** True when a tool name has a typed rendered contract in the registry. */
export function isRenderedToolName(toolName: string): toolName is RenderedToolName {
  return Object.hasOwn(assistantToolResultSchemas, toolName);
}

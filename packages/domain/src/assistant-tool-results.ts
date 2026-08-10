import { z } from "zod";
import { assetMemoryValueSchema } from "./asset-memories";
import { assetKindSchema, assetOwnershipSchema } from "./assets";
import { draftProposalResultSchema } from "./draft-proposals";
import { memoryCuratorProposalResultSchema } from "./memory-curator";
import { privacyScopeSchema } from "./privacy";

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

/**
 * The compact, id-carrying General Action reference every General Action tool returns
 * to the channel (mirrors the agent's `toGeneralActionRef`). The web parses this exact
 * shape to render created actions, suggested-action review cards, and ledger lists; the
 * `component` field and any other extra keys the tool attaches are stripped by the
 * object schema so only the minimized contract crosses the seam (ADRs 0028, 0148).
 */
export const generalActionRef = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  dueAt: z.string().nullable(),
  deferUntil: z.string().nullable(),
  isRoutine: z.boolean(),
  recurrence: z.string().nullable(),
  areaId: z.string().nullable(),
  people: z.array(z.object({ id: z.string(), displayName: z.string() })),
  visibilityChoice: z.enum(["only_me", "selected_members", "whole_household"]).nullable(),
  visibilityLabel: z.string().nullable(),
});

export const createdGeneralActionToolResult = z.object({
  action: generalActionRef,
});

export const suggestedGeneralActionReviewItem = z.object({
  action: generalActionRef,
  sourceRecord: z.object({ id: z.string() }).nullish(),
});

export const suggestedGeneralActionToolResult = z.object({
  found: z.literal(true),
  ...suggestedGeneralActionReviewItem.shape,
});

/** A shallow plan is a small batch of ordinary suggestions; each proposed step renders
 *  as its own review card, so the list and the plan share one contract. */
export const plannedGeneralActionsToolResult = z.object({
  found: z.literal(true),
  proposed: z.array(z.object({ action: generalActionRef })),
});

export const suggestedGeneralActionListToolResult = z.object({
  found: z.literal(true),
  reviews: z.array(suggestedGeneralActionReviewItem),
});

/**
 * Reminders proposed from an Asset's reviewed details (#203). Each proposal is an
 * ordinary Suggested General Action, so it renders as the same review card every other
 * proposal does — there is no asset-specific review card, because there is no
 * asset-specific review path. The asset rides along only to name what the pass was
 * about; an empty `proposed` list is a normal, calm result.
 */
export const assetActionProposalsToolResult = z.object({
  found: z.literal(true),
  asset: z.object({ id: z.string(), name: z.string() }),
  proposed: z.array(z.object({ action: generalActionRef })),
});

/**
 * Asset facts Eve proposed for review (#196 story 57). This is the persisted shape of
 * one Asset Review Group as it leaves the tool: the anchor Asset (an existing one the
 * user named, or a still-`suggested` one when nothing matched), the Suggested Asset
 * Memories waiting on it, and the duplicate candidates the #198 matcher found. It
 * carries exactly what the shared Asset Review Group card already renders in the Review
 * tab, so a proposal made in chat is reviewed by the *same* card rather than a chat-only
 * lookalike — one review surface, accepted/edited/dismissed/linked in one place.
 *
 * Nothing in here is durable. Every record referenced is `suggested` until the user
 * accepts it, which is the whole point: Eve proposes an asset fact, it never saves one.
 */
export const assetMemoryProposalToolResult = z.object({
  found: z.literal(true),
  groupId: z.string(),
  asset: z.object({
    id: z.string(),
    name: z.string(),
    kind: assetKindSchema,
    kindLabel: z.string(),
    scope: privacyScopeSchema,
    visibilityLabel: z.string(),
    /**
     * The anchor's ownership form, so the review card can tell "shared with the
     * household" apart from "is the household's" (ADR 0214). Defaulted, because a
     * tool result persisted before this field existed must still parse.
     */
    ownership: assetOwnershipSchema.default("member_owned"),
    /** True while the anchor itself is a pending Suggested Asset (nothing matched). */
    pending: z.boolean(),
  }),
  memories: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      // The typed value, unformatted: the surface formats it for display, so the
      // exact stored fact (a model number, a date, a cadence) never round-trips
      // through prose on its way to the review card.
      value: assetMemoryValueSchema.nullable(),
      notes: z.string().nullable(),
    }),
  ),
  /** Existing Assets the pending anchor may duplicate — the link-to-existing prompt. */
  duplicates: z.array(z.object({ id: z.string(), name: z.string(), kindLabel: z.string() })),
  /** The grounding source record: the user's own words, captured for this proposal. */
  source: z
    .object({
      id: z.string(),
      content: z.string(),
      sourceType: z.string(),
      capturedAt: z.string(),
    })
    .nullable(),
  /** Members still awaiting review: the anchor (when pending) plus each memory. */
  pendingCount: z.number(),
});

export const generalActionListToolResult = z.object({
  found: z.literal(true),
  ledger: z.string(),
  window: z.string().nullish(),
  actions: z.array(generalActionRef),
});

export const memoryCuratorToolResult = memoryCuratorProposalResultSchema;
export const draftProposalToolResult = draftProposalResultSchema;

/**
 * Registry of rendered Eve tools → their persisted result contract. The web parses
 * with these and the agent guard asserts its rendered-tool set matches the keys, so
 * a new rendered tool (or a renamed one) can't silently fall back to `generic`.
 */
/**
 * Unified Asset Search results (#204). Grounded records only — every entry is a real
 * row with its trust register, the signals that found it, and the visibility it was
 * read under. There is no "answer" field: Eve writes the prose, and it must write it
 * from these records.
 */
export const assetSearchToolResult = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      recordKind: z.enum(["asset", "asset_memory", "asset_evidence"]),
      recordId: z.string(),
      assetId: z.string(),
      assetName: z.string(),
      assetKind: z.string(),
      label: z.string(),
      snippet: z.string(),
      value: z.string().nullable(),
      matchKinds: z.array(z.enum(["structured", "exact", "semantic"])),
      trustLevel: z.enum(["asset_anchor", "asset_fact", "suggested_asset_fact", "asset_evidence"]),
      visibilityChoice: z.enum(["only_me", "selected_members", "whole_household"]),
      visibilityLabel: z.string(),
    }),
  ),
});

/**
 * Snapshot-backed Asset context (#204). `summary` is *generated prose* and is labeled
 * as such by `snapshotStatus`; `facts` are the reviewed records it stands on. The two
 * are deliberately separate fields so a consumer — and Eve — can never mistake the
 * cache for the truth.
 */
export const assetContextToolResult = z.object({
  assetId: z.string(),
  assetName: z.string(),
  assetKind: z.string(),
  assetStatus: z.string(),
  visibilityLabel: z.string(),
  snapshotStatus: z.enum(["fresh", "rebuilt", "fallback"]),
  summary: z.string().nullable(),
  facts: z.array(
    z.object({
      memoryId: z.string(),
      label: z.string(),
      value: z.string().nullable(),
      notes: z.string().nullable(),
      visibilityLabel: z.string(),
    }),
  ),
  evidence: z.array(z.object({ evidenceId: z.string(), kind: z.string(), label: z.string() })),
  relatedAssets: z.array(z.object({ assetId: z.string(), relation: z.string(), name: z.string() })),
  actions: z.array(
    z.object({
      actionId: z.string(),
      title: z.string(),
      status: z.string(),
      dueAt: z.string().nullable(),
    }),
  ),
});

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
  create_general_action: createdGeneralActionToolResult,
  suggest_general_action: suggestedGeneralActionToolResult,
  get_suggested_general_action_review: suggestedGeneralActionToolResult,
  plan_suggested_general_actions: plannedGeneralActionsToolResult,
  list_suggested_general_action_reviews: suggestedGeneralActionListToolResult,
  list_general_actions: generalActionListToolResult,
  propose_asset_actions: assetActionProposalsToolResult,
  propose_asset_memories: assetMemoryProposalToolResult,
  search_assets: assetSearchToolResult,
  get_asset_context: assetContextToolResult,
} as const satisfies Record<string, z.ZodTypeAny>;

/** A tool name that persists a typed, rendered result (vs. a `generic` fallback). */
export type RenderedToolName = keyof typeof assistantToolResultSchemas;

/** The rendered tool names, for guards that must enumerate the contract. */
export const RENDERED_TOOL_NAMES = Object.keys(assistantToolResultSchemas) as RenderedToolName[];

export type SuggestedMemoryReviewItemOutput = z.infer<typeof suggestedMemoryReviewItem>;
export type SuggestedFollowupReviewItemOutput = z.infer<typeof suggestedFollowupReviewItem>;
export type GeneralActionRefOutput = z.infer<typeof generalActionRef>;
export type SuggestedGeneralActionReviewItemOutput = z.infer<
  typeof suggestedGeneralActionReviewItem
>;
export type GeneralActionListToolResult = z.infer<typeof generalActionListToolResult>;
export type AssetMemoryProposalToolResult = z.infer<typeof assetMemoryProposalToolResult>;
export type RelationshipAgendaToolResult = z.infer<typeof relationshipAgendaToolResult>;
export type MemoryCuratorToolResult = z.infer<typeof memoryCuratorToolResult>;
export type DraftProposalToolResult = z.infer<typeof draftProposalToolResult>;

/** True when a tool name has a typed rendered contract in the registry. */
export function isRenderedToolName(toolName: string): toolName is RenderedToolName {
  return Object.hasOwn(assistantToolResultSchemas, toolName);
}

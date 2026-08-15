import { z } from "zod";
import { assetMemoryValueSchema } from "./asset-memories";
import { assetKindSchema, assetOwnershipSchema } from "./assets";
import { conversationalCaptureConfirmationSchema } from "./conversational-capture-schemas";
import { draftProposalResultSchema } from "./draft-proposals";
import { exactRecallRecordKindSchema, exactRecallTrustLevelSchema } from "./exact-recall";
import { globalRecallResponseSchema } from "./global-recall";
import { householdCoordinationFamilySchema } from "./household-home";
import { memoryCuratorProposalResultSchema, memoryCuratorProposalSchema } from "./memory-curator";
import { privacyScopeSchema } from "./privacy";
import {
  relationshipSemanticRecordKindSchema,
  relationshipSemanticTrustLevelSchema,
} from "./semantic-retrieval";

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

/**
 * Exact Recall as a chat card.
 *
 * `recordKind` and `trustLevel` are the *shared* search enums rather than copies of
 * them, and that is the whole point. They used to be hand-written subsets that
 * predated General Actions (ADR 0150), so the moment a search matched an Action the
 * card schema rejected the row, the parser returned null, and the entire result set
 * vanished into a "didn't return a readable result" line — one unrenderable row cost
 * the user every row beside it. Referencing the producing contract means the card can
 * never again be narrower than what the tool can return: widening the search widens
 * the card in the same commit or fails to compile.
 */
export const relationshipContextSearchToolResult = z.object({
  results: z.array(
    z.object({
      recordKind: exactRecallRecordKindSchema,
      recordId: z.string(),
      visibilityChoice: z.enum(["only_me", "selected_members", "whole_household"]).nullable(),
      visibilityLabel: z.string().nullable(),
      relatedPersonId: z.string().nullish(),
      relatedPersonDisplayName: z.string().nullish(),
      label: z.string(),
      snippet: z.string(),
      matchedFields: z.array(z.string()),
      trustLevel: exactRecallTrustLevelSchema,
      sensitivity: z.enum(["normal", "sensitive", "restricted"]),
    }),
  ),
});

/** Semantic Retrieval as a chat card, on the same shared-enum rule as Exact Recall. */
export const semanticContextSearchToolResult = z.object({
  results: z.array(
    z.object({
      recordKind: relationshipSemanticRecordKindSchema,
      recordId: z.string(),
      visibilityChoice: z.enum(["only_me", "selected_members", "whole_household"]),
      visibilityLabel: z.string(),
      relatedPersonId: z.string().nullish(),
      relatedPersonDisplayName: z.string().nullish(),
      snippet: z.string(),
      similarity: z.number(),
      trustLevel: relationshipSemanticTrustLevelSchema,
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

/**
 * A created Action may carry one explicit Reminder Schedule. This is a deliberately
 * compact presentation contract: the web needs the concrete label and intended
 * instant, but never the schedule or occurrence ids. A failed reminder stays visibly
 * distinct from the successful Action so a partial write cannot look fully scheduled.
 */
export const createdGeneralActionReminder = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("scheduled"),
    label: z.string().min(1),
    timeZone: z.string().min(1),
    intendedAt: z.string().min(1),
    optInOffered: z.boolean(),
  }),
  z.object({
    status: z.literal("failed"),
    reason: z.literal("unavailable"),
  }),
]);

export const createdGeneralActionToolResult = z.object({
  action: generalActionRef,
  reminder: createdGeneralActionReminder.nullish(),
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

/**
 * The rendered contract for `propose_memory_cleanup`.
 *
 * The owner id the shared read echoes back identifies the caller to the caller, so
 * the tool stops it rather than sending it out to the channel with every card; the
 * card never read it. Omitting it here keeps the parse honest in both directions -
 * nothing new is required, and a message persisted while the id still travelled
 * still parses, because the object is not strict.
 */
export const memoryCuratorToolResult = memoryCuratorProposalResultSchema
  .omit({ ownerUserId: true })
  .extend({ proposals: z.array(memoryCuratorProposalSchema.omit({ ownerUserId: true })) });
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
      /**
       * The anchor's ownership form, so the chat card can tell "shared with the
       * household" apart from "is the household's" and stop naming an audience
       * nobody chose (ADR 0214). The last Asset Search surface to get it: the web
       * panel, the ledger, the profile, and the review card all suppress the label
       * on a household-native record, and a chat card that still stated one would
       * be the same record described two ways in one product. Defaulted, because a
       * tool result persisted before this field existed must still parse.
       */
      ownership: assetOwnershipSchema.default("member_owned"),
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
  /** The Asset's own ownership form, for the same audience rule (ADR 0214). */
  ownership: assetOwnershipSchema.default("member_owned"),
  snapshotStatus: z.enum(["fresh", "rebuilt", "fallback"]),
  summary: z.string().nullable(),
  facts: z.array(
    z.object({
      memoryId: z.string(),
      label: z.string(),
      value: z.string().nullable(),
      notes: z.string().nullable(),
      visibilityLabel: z.string(),
      /**
       * The *anchor's* form again, not the memory row's — the same rule Asset
       * Search reports by, so one fact does not describe itself differently
       * depending on which surface asked for it.
       */
      ownership: assetOwnershipSchema.default("member_owned"),
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

/**
 * One member's Household check-in, as a chat card reads it.
 *
 * Every field is a fact the record already carries: what kind of thing it is, when
 * it matters, whose it is, and who said they are looking after it. There is
 * deliberately no summary, no ranking, and no count of what was left out — the set
 * was capped deterministically before any model saw it, and a remaining number on
 * a shared list is a backlog badge (ADR 0220).
 *
 * `household` is the workspace's name and is null for a member with none, which is
 * how the card tells "you have left" apart from "nothing is timely".
 */
export const householdCheckinToolResult = z.object({
  household: z.object({ name: z.string().min(1) }).nullable(),
  optedIn: z.boolean(),
  count: z.number().int().min(0),
  records: z.array(
    z.object({
      recordKind: z.string().min(1),
      recordId: z.string().min(1),
      /** The domain family, so the row picks a glyph from a fact rather than prose. */
      family: householdCoordinationFamilySchema,
      href: z.string().min(1),
      title: z.string().min(1),
      /** The record's own type and cadence, in words. "Action", "Routine · weekly". */
      context: z.string().min(1),
      /** Factual and unhurried. Never "overdue", "missed", or "late". */
      timing: z.string().min(1),
      /** "Household", or "Shared by Mara". Attribution, never responsibility. */
      scopeLabel: z.string().min(1),
      /** "Ana is looking after this", or null — the ordinary, calm case. */
      responsibility: z.string().nullable(),
    }),
  ),
  limitations: z.array(z.string().min(1)),
});

/**
 * The Gift Plans a caller may see.
 *
 * Nothing here describes the audience: no co-planner list, no member names, no
 * Surprise Subject flag. A protected plan is simply absent for the person it
 * protects against, and for everyone else the card must not carry the *shape* of
 * the protection either (ADR 0216).
 *
 * `isOwner` is the one authority fact, and it is a fact about the caller rather
 * than about the plan: only the owner may re-subject, re-address, or end it, while
 * a co-planner contributes. The card says which of the two the reader is, so the
 * absence of an affordance is explained rather than mysterious.
 */
export const giftPlanSearchToolResult = z.object({
  query: z.string().nullable(),
  count: z.number().int().min(0),
  plans: z.array(
    z.object({
      giftPlanId: z.string().min(1),
      subjectName: z.string().min(1),
      occasion: z.string().min(1),
      occasionOn: z.iso.datetime().nullable(),
      status: z.string().min(1),
      ideaCount: z.number().int().min(0),
      claimedIdeaCount: z.number().int().min(0),
      isOwner: z.boolean(),
    }),
  ),
});

/** One idea added to a plan by the caller, on their explicit request. */
export const giftIdeaAddedToolResult = z.object({
  added: z.literal(true),
  giftIdeaId: z.string().min(1),
  giftPlanId: z.string().min(1),
  title: z.string().min(1),
});

/**
 * What an explicit Capture actually did, as a card the user can check against
 * Eve's paraphrase.
 *
 * The audience is the point. Capture's household branch is a privacy-consequential
 * fork, and a fork confirmed only by generated prose is a fork nobody verified:
 * the model can say "saved to your household" about a private save, or the reverse,
 * and the transcript reads identically either way. So the visibility each outcome
 * was *actually written with* is rendered from the persisted result.
 */
export const captureOutcomeToolResult = z.object({
  confirmation: conversationalCaptureConfirmationSchema,
});

/**
 * The audience each capture outcome was actually written with.
 *
 * Reads the confirmation the seam produced rather than anything the model said
 * about it, and flattens a grouped capture into its parts so a multi-clause save
 * reports one audience per record instead of one for the group. The field the
 * audience lives on differs by destination — Saved Items call it `visibility`,
 * every other domain calls it `scope` — which is precisely why this lives here
 * once instead of at each surface that needs to show it.
 */
export function captureOutcomeAudiences(
  confirmation: z.infer<typeof conversationalCaptureConfirmationSchema>,
): Array<{ destination: string; visibility: string }> {
  const outcomes = confirmation.destination === "Grouped" ? confirmation.outcomes : [confirmation];
  return outcomes.map((outcome) => ({
    destination: outcome.destination,
    visibility:
      "visibility" in outcome.interpreted
        ? outcome.interpreted.visibility
        : outcome.interpreted.scope,
  }));
}

/**
 * Global Recall as a chat card (ADR 0199).
 *
 * Deliberately the shared response contract itself, not a minimized copy of it. Global
 * Recall's whole promise is that one record reads the same wherever recall found it —
 * same canonical citation, same trust register, same visibility label, same deep link
 * the palette and the phone's Search flow open. A second, chat-only shape here would
 * be a second answer to what a recall row says, and the surfaces would drift.
 *
 * `limitations` and `hasMore` travel with the results for the same reason the search
 * surfaces show them: what recall could not reach is part of the answer, and a card
 * that dropped them would quietly present a partial read as a complete one.
 */
export const globalRecallToolResult = globalRecallResponseSchema;

export const assistantToolResultSchemas = {
  capture_source_record: sourceRecordToolResult,
  capture_memory: memoryToolResult,
  create_person: personToolResult,
  update_person: personUpdatedToolResult,
  get_person_context: personContextToolResult,
  create_message_draft: messageDraftToolResult,
  get_suggested_memory_review: suggestedMemoryToolResult,
  // The producer of the same review card. A proposal the user cannot accept or
  // dismiss where it appears is a proposal in name only, so it renders as the card
  // the queue already owns rather than as a line of Eve's prose about it.
  propose_suggested_memory: suggestedMemoryToolResult,
  list_suggested_memory_reviews: suggestedMemoryListToolResult,
  propose_followup: suggestedFollowupToolResult,
  get_suggested_followup_review: suggestedFollowupToolResult,
  list_suggested_followup_reviews: suggestedFollowupListToolResult,
  search_relationship_context: relationshipContextSearchToolResult,
  search_semantic_context: semanticContextSearchToolResult,
  search_global_recall: globalRecallToolResult,
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
  household_check_in: householdCheckinToolResult,
  search_gift_plans: giftPlanSearchToolResult,
  add_gift_idea: giftIdeaAddedToolResult,
  capture_saved_item: captureOutcomeToolResult,
} as const satisfies Record<string, z.ZodTypeAny>;

/** A tool name that persists a typed, rendered result (vs. a `generic` fallback). */
export type RenderedToolName = keyof typeof assistantToolResultSchemas;

/** The rendered tool names, for guards that must enumerate the contract. */
export const RENDERED_TOOL_NAMES = Object.keys(assistantToolResultSchemas) as RenderedToolName[];

export type SuggestedMemoryReviewItemOutput = z.infer<typeof suggestedMemoryReviewItem>;
export type SuggestedFollowupReviewItemOutput = z.infer<typeof suggestedFollowupReviewItem>;
export type GeneralActionRefOutput = z.infer<typeof generalActionRef>;
export type CreatedGeneralActionReminderOutput = z.infer<typeof createdGeneralActionReminder>;
export type CreatedGeneralActionToolResult = z.infer<typeof createdGeneralActionToolResult>;
export type SuggestedGeneralActionReviewItemOutput = z.infer<
  typeof suggestedGeneralActionReviewItem
>;
export type GeneralActionListToolResult = z.infer<typeof generalActionListToolResult>;
export type AssetMemoryProposalToolResult = z.infer<typeof assetMemoryProposalToolResult>;
export type RelationshipAgendaToolResult = z.infer<typeof relationshipAgendaToolResult>;
export type MemoryCuratorToolResult = z.infer<typeof memoryCuratorToolResult>;
export type DraftProposalToolResult = z.infer<typeof draftProposalToolResult>;
export type HouseholdCheckinToolResult = z.infer<typeof householdCheckinToolResult>;
export type GiftPlanSearchToolResult = z.infer<typeof giftPlanSearchToolResult>;
export type GlobalRecallToolResult = z.infer<typeof globalRecallToolResult>;
export type CaptureOutcomeToolResult = z.infer<typeof captureOutcomeToolResult>;

/** True when a tool name has a typed rendered contract in the registry. */
export function isRenderedToolName(toolName: string): toolName is RenderedToolName {
  return Object.hasOwn(assistantToolResultSchemas, toolName);
}

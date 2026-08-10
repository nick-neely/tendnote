import type { AssetReviewGroupView } from "@/lib/asset-review-view";

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
  | {
      kind: "message_draft";
      draftId: string;
      personId: string | null;
      status: string;
      body: string;
      grounding: { trust: string; label: string }[];
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
  | {
      kind: "memory_curator_proposals";
      proposals: MemoryCuratorProposalView[];
    }
  | {
      kind: "draft_proposal";
      proposal: DraftProposalView | null;
      skippedReason: "person_not_found" | "insufficient_context" | "generation_failed" | null;
    }
  | ({ kind: "created_general_action" } & GeneralActionListItemView)
  | ({ kind: "suggested_general_action_review" } & SuggestedGeneralActionReviewItemView)
  | {
      kind: "suggested_general_action_review_list";
      reviews: SuggestedGeneralActionReviewItemView[];
    }
  | {
      kind: "general_action_list";
      ledger: string;
      window: string | null;
      actions: GeneralActionListItemView[];
    }
  | {
      kind: "asset_search";
      query: string;
      results: AssetSearchResultView[];
    }
  /**
   * Asset facts Eve proposed for review (#196 story 57). The payload is the *same*
   * `AssetReviewGroupView` the Review tab's card takes, so the proposal is reviewed in
   * chat by the very card that reviews it in the queue — one review surface, not a
   * chat-only imitation that could drift from it.
   */
  | { kind: "asset_review_group"; review: AssetReviewGroupView }
  | {
      kind: "asset_context";
      found: boolean;
      assetName: string | null;
      /** Whether the shown summary is a live cache or a stale/missing one. */
      snapshotStatus: "fresh" | "rebuilt" | "fallback" | null;
      summary: string | null;
      facts: AssetFactView[];
      evidence: { evidenceId: string; kind: string; label: string }[];
      actions: { actionId: string; title: string; status: string; dueAt: string | null }[];
    }
  /**
   * The safe fallback for output that did not project to a typed view. Three honest,
   * visually distinct outcomes share this kind:
   *
   * - benign unrecognized tool (`malformed`/`note` both absent) — a quiet housekeeping
   *   line naming the tool that ran;
   * - a *well-formed negative* outcome of a known tool (`note` set) — an honest,
   *   neutral line in plain copy ("No draft was created", "Nothing to review"); the
   *   tool succeeded and returned a real "nothing happened" result, so it is never
   *   dressed up as an error;
   * - a *malformed* payload of a known tool (`malformed: true`) — a schema-invalid,
   *   possibly-failed result shown as visibly degraded, never as routine.
   *
   * `note` and `malformed` are mutually exclusive: a recognized negative is not a
   * failure, and a failure has no honest copy to show.
   */
  | { kind: "generic"; toolName: string; malformed?: boolean; note?: string };

/**
 * One grounded Asset Search result. `value` is the exact stored value — the answer to
 * "what filter does the fridge need?" — kept as its own field so the card can show it
 * as the fact it is rather than burying it in a snippet. `matchKinds` explains *why*
 * this row was found, which is what makes a fused search legible instead of magic.
 */
export type AssetSearchResultView = {
  recordKind: "asset" | "asset_memory" | "asset_evidence";
  recordId: string;
  assetId: string;
  assetName: string;
  label: string;
  snippet: string;
  value: string | null;
  matchKinds: ("structured" | "exact" | "semantic")[];
  trustLevel: "asset_anchor" | "asset_fact" | "suggested_asset_fact" | "asset_evidence";
  visibilityLabel: string;
  /**
   * The anchor's ownership form. The card reads it to decide whether an audience is
   * a thing anyone chose: on a household-native record there is none to name, and
   * stating one would invent a sharing decision (ADR 0214).
   */
  ownership: "member_owned" | "household_native";
};

/** One reviewed fact about an Asset — a confirmed record, never snapshot prose. */
export type AssetFactView = {
  memoryId: string;
  label: string;
  value: string | null;
  notes: string | null;
  visibilityLabel: string;
  /** The anchor's form, for the same audience rule as the search row above. */
  ownership: "member_owned" | "household_native";
};

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
  timingLabel: string;
  sourceRecordId: string | null;
  personId: string | null;
  personName: string | null;
};

/**
 * One tentative Suggested General Action the user can accept or dismiss inline. The
 * timing/cadence and linked people are resolved to plain labels so the card never
 * re-derives a timezone or leaks a raw id; the full edit lives on the /actions ledger.
 */
export type SuggestedGeneralActionReviewItemView = {
  generalActionId: string;
  title: string;
  status: string;
  /** Calm domain timing phrase, or null for an unscheduled "someday" proposal. */
  timingLabel: string | null;
  isRoutine: boolean;
  /** Plain cadence label ("Every 6 months") for a Routine proposal; else null. */
  recurrenceLabel: string | null;
  /** Names of the people this action is a context link for (bounded, no ids). */
  personNames: string[];
  visibilityLabel: string | null;
};

/**
 * One General Action as it reads in a ledger list or a created-action confirmation:
 * its title, a resolved surfacing label (due/set-aside/none), Routine cadence, linked
 * people, and visibility — everything the surface shows without leaking a raw id.
 */
export type GeneralActionListItemView = {
  generalActionId: string;
  title: string;
  status: string;
  isRoutine: boolean;
  recurrenceLabel: string | null;
  /** Resolved surfacing cue ("Due Jul 15", "Set aside until …", "No date"). */
  timingLabel: string | null;
  personNames: string[];
  visibilityLabel: string | null;
};

export type RelationshipContextSearchResultView = {
  recordKind: "person" | "memory" | "source_record";
  recordId: string;
  visibilityChoice?: "only_me" | "selected_members" | "whole_household" | null;
  visibilityLabel?: string | null;
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
  visibilityChoice: "only_me" | "selected_members" | "whole_household";
  visibilityLabel: string;
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
  visibilityChoice?: "only_me" | "selected_members" | "whole_household" | null;
  visibilityLabel?: string | null;
  rank: number;
};

export type MemoryCuratorProposalView = {
  id: string;
  proposalKind:
    | "duplicate_memory"
    | "stale_memory_archive"
    | "contradiction_warning"
    | "rewrite_suggestion"
    | "clarification_prompt"
    | "source_record_cleanup";
  personId: string | null;
  personDisplayName: string | null;
  title: string;
  reason: string;
  suggestedAction: string;
  sourceRefs: { kind: "memory" | "source_record"; id: string; label: string }[];
  sensitivity: "normal" | "sensitive" | "restricted";
  reviewOnly: true;
};

export type DraftProposalView = {
  id: string;
  personId: string;
  personDisplayName: string;
  channel: "text" | "email" | "slack" | "other";
  purpose: "birthday" | "thank_you" | "check_in" | "networking" | "other";
  variants: { id: string; label: string; toneInstruction: string; body: string }[];
  sourceRefs: {
    kind: "approved_memory" | "source_record" | "suggested_memory" | "followup" | "brief_item";
    id: string;
    label: string;
    trust: "confirmed_fact" | "logged_context" | "tentative" | "intent" | "entry_point";
  }[];
  ephemeral: true;
  persistenceRequiresExplicitOwnerIntent: true;
};

/**
 * Visual weight a rendered tool result earns (see the result-module registry).
 * Each module owns the tier for its own kind; `toolViewTier` in the registry is the
 * thin dispatcher over these.
 */
export type ToolViewTier = "line" | "card" | "disclosure";

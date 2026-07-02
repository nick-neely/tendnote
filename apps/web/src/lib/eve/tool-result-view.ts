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
    case "message_draft":
      return `draft:${view.draftId}`;
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
    case "memory_curator_proposals":
      return `memory-curator:${view.proposals.map((proposal) => proposal.id).join(":")}`;
    case "draft_proposal":
      return view.proposal ? `draft-proposal:${view.proposal.id}` : `draft-proposal:skipped`;
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
    case "memory_curator_proposals":
      return view.proposals.length > 0 ? "card" : "line";
    case "draft_proposal":
      return view.proposal ? "card" : "line";
    case "message_draft":
      // A persisted, durable draft earns the card — the user must see what was
      // written (and the Tendnote-only boundary) and act on it.
      return "card";
    default:
      return "card";
  }
}

const ACTIVE_TOOL_LABELS: Record<string, string> = {
  search_people: "Searching people…",
  search_relationship_context: "Searching your notebook…",
  search_semantic_context: "Searching by meaning…",
  get_relationship_agenda: "Checking your relationship agenda…",
  propose_memory_cleanup: "Reviewing memory cleanup candidates…",
  propose_message_draft: "Drafting options…",
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
  create_message_draft: "Drafting a message…",
  create_person: "Adding to your notebook…",
  update_person: "Updating the profile…",
};

/** Present-continuous label for an in-flight tool call (the shimmer line). */
export function activeToolLabel(toolName: string): string {
  return ACTIVE_TOOL_LABELS[toolName] ?? `${toolName.replace(/_/g, " ")}…`;
}

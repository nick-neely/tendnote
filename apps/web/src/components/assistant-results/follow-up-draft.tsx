import {
  assistantToolResultSchemas,
  type DraftProposalToolResult,
  resolveRecordTiming,
  type SuggestedFollowupReviewItemOutput,
} from "@tendnote/domain";
import { Body, Caption, ResultCard } from "@/components/assistant-result-card";
import { MessageSquareTextIcon } from "@/components/icons";
import type {
  AssistantToolView,
  DraftProposalView,
  SuggestedFollowupReviewItemView,
} from "@/lib/eve/tool-result-view";
import { defineModule } from "./module";
import { flagIsFalse } from "./shared";
import { ToolActivityLine } from "./shells";

/**
 * Follow-Up and draft result modules (#226): Suggested Follow-Up single/list review,
 * Tendnote-owned Message Drafts, and ephemeral Draft Proposals. Interactive review
 * and grounding stay local; the modules keep persisted Message Drafts distinct from
 * ephemeral proposals, and neither ever creates an external draft or send — the
 * explicit-approval boundary lives in the tools, and nothing here weakens it.
 */

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

function toFollowupReviewItem(
  parsed: SuggestedFollowupReviewItemOutput,
): SuggestedFollowupReviewItemView {
  return {
    followupId: parsed.followup.id,
    reason: parsed.followup.reason,
    timingLabel: resolveRecordTiming(
      {
        kind: "followup",
        status: "suggested",
        dueAt: new Date(parsed.followup.dueAt),
      },
      new Date(),
    ).timingLabel,
    sourceRecordId: parsed.sourceRecord?.id ?? null,
    personId: parsed.person?.id ?? parsed.followup.personId ?? null,
    personName: parsed.person?.displayName ?? null,
  };
}

function toDraftProposal(
  proposal: NonNullable<DraftProposalToolResult["proposal"]>,
): DraftProposalView {
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

/** Both the propose and the later review read of a suggested follow-up share one parse+project. */
function parseFollowupReview(
  output: unknown,
): Extract<AssistantToolView, { kind: "suggested_followup_review" }> | null {
  const parsed = assistantToolResultSchemas.get_suggested_followup_review.safeParse(output);
  if (!parsed.success) return null;
  return { kind: "suggested_followup_review", ...toFollowupReviewItem(parsed.data) };
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function labelDraftSourceKind(kind: DraftProposalView["sourceRefs"][number]["kind"]): string {
  switch (kind) {
    case "approved_memory":
      return "Memory";
    case "source_record":
      return "Source record";
    case "suggested_memory":
      return "Suggested memory";
    case "followup":
      return "Follow-up";
    case "brief_item":
      return "Brief item";
  }
}

function labelDraftProposalSkip(
  reason: Extract<AssistantToolView, { kind: "draft_proposal" }>["skippedReason"],
): string {
  switch (reason) {
    case "person_not_found":
      return "No draft options: Tendnote couldn't find that person";
    case "generation_failed":
      return "No draft options: drafting is temporarily unavailable";
    default:
      return "No draft options: not enough saved context yet";
  }
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

/** Tentative Suggested Follow-Up — routed to the interactive ChatFollowupReviewCard. */
export const suggestedFollowupReviewModule = defineModule<"suggested_followup_review">({
  kind: "suggested_followup_review",
  parsers: {
    propose_followup: parseFollowupReview,
    get_suggested_followup_review: parseFollowupReview,
  },
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "found"),
    note: "No suggested follow-up to review",
  },
  tier: () => "card",
  key: (view) => `suggested-followup:${view.followupId}`,
  interactive: true,
});

export const suggestedFollowupReviewListModule = defineModule<"suggested_followup_review_list">({
  kind: "suggested_followup_review_list",
  parsers: {
    list_suggested_followup_reviews: (output) => {
      const parsed = assistantToolResultSchemas.list_suggested_followup_reviews.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "suggested_followup_review_list",
        reviews: parsed.data.reviews.map(toFollowupReviewItem),
      };
    },
  },
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "found"),
    note: "No follow-ups to review",
  },
  tier: () => "card",
  key: (view) =>
    `suggested-followup-list:${view.reviews.map((review) => review.followupId).join(":")}`,
  interactive: true,
});

/** A persisted, Tendnote-owned draft — never an external draft or send. Interactive (WYSIWYG edit + copy). */
export const messageDraftModule = defineModule<"message_draft">({
  kind: "message_draft",
  parsers: {
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
  },
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "created"),
    note: "No draft was created",
  },
  tier: () => "card",
  key: (view) => `draft:${view.draftId}`,
  interactive: true,
});

/** Draft Proposal: ephemeral options, never saved as a Tendnote draft until the owner asks. */
export const draftProposalModule = defineModule<"draft_proposal">({
  kind: "draft_proposal",
  parsers: {
    propose_message_draft: (output) => {
      const parsed = assistantToolResultSchemas.propose_message_draft.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "draft_proposal",
        proposal: parsed.data.proposal ? toDraftProposal(parsed.data.proposal) : null,
        skippedReason: parsed.data.skippedReason ?? null,
      };
    },
  },
  tier: (view) => (view.proposal ? "card" : "line"),
  summary: (view) => (view.proposal ? null : labelDraftProposalSkip(view.skippedReason)),
  key: (view) => (view.proposal ? `draft-proposal:${view.proposal.id}` : `draft-proposal:skipped`),
  render: (view, isNew) => {
    if (!view.proposal) {
      return (
        <ToolActivityLine
          icon={<MessageSquareTextIcon aria-hidden className="size-3.5" />}
          isNew={isNew}
        >
          {labelDraftProposalSkip(view.skippedReason)}
        </ToolActivityLine>
      );
    }
    const { proposal } = view;
    return (
      <ResultCard
        footer={<Caption>Draft Proposal only · not saved as a Tendnote draft</Caption>}
        icon={<MessageSquareTextIcon className="size-3" />}
        isNew={isNew}
        kind={view.kind}
        label={`Draft options for ${proposal.personDisplayName}`}
        tone="neutral"
      >
        <div className="flex flex-col gap-3">
          {proposal.variants.map((variant) => (
            <div className="flex flex-col gap-1.5" key={variant.id}>
              <Caption>{variant.label}</Caption>
              <Body>{variant.body}</Body>
            </div>
          ))}
          <Caption>
            Grounded in{" "}
            {proposal.sourceRefs
              .map((sourceRef) => `${labelDraftSourceKind(sourceRef.kind)}: ${sourceRef.label}`)
              .join("; ")}
          </Caption>
        </div>
      </ResultCard>
    );
  },
});

"use client";

import {
  acceptSuggestedFollowupAction,
  dismissSuggestedFollowupAction,
} from "@/app/actions/suggested-followups";
import {
  ChatReviewActionCard,
  type ReviewActionLabels,
} from "@/components/chat-review-action-card";
import type {
  AssistantToolView,
  SuggestedFollowupReviewItemView,
} from "@/lib/eve/tool-result-view";

/**
 * Renders the interactive cards for a `list_suggested_followup_reviews` result —
 * every open suggested follow-up returned in one call. Empty resolves to nothing;
 * the assistant's own reply covers "nothing to review".
 */
export function ChatFollowupReviewList({
  view,
  isNew = false,
}: {
  view: Extract<AssistantToolView, { kind: "suggested_followup_review_list" }>;
  isNew?: boolean;
}) {
  if (view.reviews.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {view.reviews.map((item) => (
        <ChatFollowupReviewCard isNew={isNew} item={item} key={item.followupId} />
      ))}
    </div>
  );
}

/**
 * Interactive in-chat review for a suggested follow-up. It is tentative until the
 * user acts; this lets them accept it (promoting it to an active reminder) or dismiss
 * it inline — the moment it is proposed (`propose_followup`) or surfaced for review —
 * through the same owner-scoped review mutations the dashboard and person ledger use,
 * without leaving the conversation. Editing the timing before accepting lives on the
 * person's ledger. Shares the one review-card primitive with suggested memories so the
 * two read as one vocabulary.
 */
export function ChatFollowupReviewCard({
  item,
  isNew = false,
}: {
  item: SuggestedFollowupReviewItemView;
  isNew?: boolean;
}) {
  const personName = item.personName ?? null;
  const labels: ReviewActionLabels = {
    pendingWord: "Suggested follow-up",
    resolvedWord: "Accepted",
    resolvedChip: "Reminder set",
    primaryAction: "Accept",
    noun: "suggested follow-up",
    pendingFooter: "Tentative. No reminder until you accept.",
    resolvedFooter: `Active reminder${personName ? ` · ${personName}` : ""}, added to your follow-ups`,
    dismissedFooter: "Dismissed. No reminder was created.",
    errorRecovery: "You can review it on the person's page.",
  };

  return (
    <ChatReviewActionCard
      content={item.reason}
      isNew={isNew}
      kind="suggested_followup_review"
      labels={labels}
      meta={`Proposed for ${item.dueLabel}`}
      onDismiss={() => dismissSuggestedFollowupAction({ followupId: item.followupId })}
      onResolve={() => acceptSuggestedFollowupAction({ followupId: item.followupId })}
      personHref={item.personId ? `/people/${item.personId}#follow-ups` : null}
      personName={personName}
    />
  );
}

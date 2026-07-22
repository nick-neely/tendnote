"use client";

import {
  dismissSuggestedMemoryAction,
  saveSuggestedMemoryAction,
} from "@/app/actions/memory-review";
import {
  ChatReviewActionCard,
  type ReviewActionLabels,
} from "@/components/chat-review-action-card";
import type { AssistantToolView, SuggestedReviewItemView } from "@/lib/eve/tool-result-view";

/**
 * Renders the interactive review cards for a `list_suggested_memory_reviews`
 * result — the "what do I have to review?" path, where one tool call returns
 * every open suggestion so they all render at once. Empty resolves to nothing;
 * the assistant's own reply covers "all caught up".
 */
export function ChatReviewList({
  view,
  isNew = false,
}: {
  view: Extract<AssistantToolView, { kind: "suggested_memory_review_list" }>;
  isNew?: boolean;
}) {
  if (view.reviews.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {view.reviews.map((item) => (
        <ChatReviewCard isNew={isNew} item={item} key={item.memoryId} />
      ))}
    </div>
  );
}

/**
 * Interactive in-chat review for a suggested memory. A suggestion is tentative until
 * the user acts; this lets them approve or dismiss it inline — the moment it is
 * proposed (`propose_memory`) or surfaced for review — through the same owner-scoped
 * review mutations the dashboard and person ledger use (ADR 0026), so they don't have
 * to leave the conversation. The full review (edit wording, sensitivity, archive)
 * still lives on the person's ledger. Shares the one review-card primitive with
 * suggested follow-ups so the two read as one vocabulary.
 */
export function ChatReviewCard({
  item,
  isNew = false,
}: {
  item: SuggestedReviewItemView;
  isNew?: boolean;
}) {
  const personName = item.personName ?? null;
  const labels: ReviewActionLabels = {
    pendingWord: "Suggested",
    resolvedWord: "Saved",
    resolvedChip: "Saved to memory",
    primaryAction: "Approve",
    noun: "suggestion",
    pendingFooter: "Tentative. Not saved until you approve.",
    resolvedFooter: `Confirmed fact${personName ? ` · ${personName}` : ""}, kept in your notebook`,
    dismissedFooter: "Dismissed. Nothing was saved.",
    errorRecovery: "You can review it on the person's page.",
  };

  return (
    <ChatReviewActionCard
      content={item.content}
      isNew={isNew}
      kind="suggested_memory_review"
      labels={labels}
      onDismiss={() => dismissSuggestedMemoryAction({ memoryId: item.memoryId })}
      onResolve={() => saveSuggestedMemoryAction({ memoryId: item.memoryId })}
      personHref={item.personId ? `/people/${item.personId}#needs-review` : null}
      personName={personName}
    />
  );
}

"use client";

import {
  acceptSuggestedGeneralActionAction,
  dismissSuggestedGeneralActionAction,
} from "@/app/actions/suggested-general-actions";
import {
  ChatReviewActionCard,
  type ReviewActionLabels,
} from "@/components/chat-review-action-card";
import { formatLinkedPeople, joinGeneralActionMeta } from "@/lib/eve/general-action-meta";
import type {
  AssistantToolView,
  SuggestedGeneralActionReviewItemView,
} from "@/lib/eve/tool-result-view";

/**
 * Renders the interactive cards for a `plan_suggested_general_actions` or
 * `list_suggested_general_action_reviews` result — every proposed step / open
 * suggestion returned in one call, each acceptable or dismissable on its own. Empty
 * resolves to nothing; the assistant's own reply covers "nothing to review".
 */
export function ChatGeneralActionReviewList({
  view,
  isNew = false,
}: {
  view: Extract<AssistantToolView, { kind: "suggested_general_action_review_list" }>;
  isNew?: boolean;
}) {
  if (view.reviews.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {view.reviews.map((item) => (
        <ChatGeneralActionReviewCard isNew={isNew} item={item} key={item.generalActionId} />
      ))}
    </div>
  );
}

/**
 * The calm caption under a suggested action: its proposed timing/cadence, linked
 * people, and visibility — every empty part dropped so an unscheduled, personless
 * proposal reads as a clean title. People are context links (never "for X"), so they
 * ride the meta line rather than the body lead. Shares the people/join formatting with
 * the created-action card and ledger rows (see general-action-meta).
 */
function reviewMeta(item: SuggestedGeneralActionReviewItemView): string | null {
  const timing = item.isRoutine
    ? (item.recurrenceLabel ?? "Routine")
    : item.dueLabel
      ? `Proposed for ${item.dueLabel}`
      : null;
  return joinGeneralActionMeta([
    timing,
    formatLinkedPeople(item.personNames),
    item.visibilityLabel,
  ]);
}

/**
 * Interactive in-chat review for a Suggested General Action. It is tentative until the
 * user acts; this lets them accept it (promoting it onto the active ledger, a Routine
 * when it carries a cadence) or dismiss it inline — the moment it is proposed
 * (`suggest_general_action` / `plan_suggested_general_actions`) or surfaced for
 * review — through the same owner-scoped, idempotent review mutations the /actions
 * ledger uses, without leaving the conversation. A promotion is idempotent, so a stale
 * card or a double click cannot double-add. The full edit (title, timing, cadence,
 * Area) lives on the /actions ledger, which the card links to. Shares the one review-
 * card primitive with suggested memories and follow-ups so the three read as one
 * vocabulary.
 */
export function ChatGeneralActionReviewCard({
  item,
  isNew = false,
}: {
  item: SuggestedGeneralActionReviewItemView;
  isNew?: boolean;
}) {
  // Keep the person out of the lead-sentence grammar (they are context links, not the
  // subject) but still name them where the confirmed card's summary would — on the
  // resolved footer once it is on the active ledger.
  const people = formatLinkedPeople(item.personNames);
  const labels: ReviewActionLabels = {
    pendingWord: item.isRoutine ? "Suggested routine" : "Suggested action",
    resolvedWord: "Accepted",
    resolvedChip: "Added to your list",
    primaryAction: "Accept",
    noun: item.isRoutine ? "suggested routine" : "suggested action",
    pendingFooter: "Tentative. Not on your list until you accept.",
    resolvedFooter: `On your active list${people ? ` · ${people}` : ""}`,
    dismissedFooter: "Dismissed. No action was added.",
    errorRecovery: "You can review it on the Actions page.",
    openLabel: "Open in Actions",
  };

  return (
    <ChatReviewActionCard
      content={item.title}
      isNew={isNew}
      kind="suggested_general_action_review"
      labels={labels}
      meta={reviewMeta(item)}
      onDismiss={() =>
        dismissSuggestedGeneralActionAction({ generalActionId: item.generalActionId })
      }
      onResolve={() =>
        acceptSuggestedGeneralActionAction({ generalActionId: item.generalActionId })
      }
      // Deep-link the exact row so the ledger scroll-and-pulse highlight fires
      // (useDeepLinkHighlight), instead of dropping the user at the top of a long list.
      // People are context links, not the subject — never render as "for X".
      personHref={`/actions#action-${item.generalActionId}`}
      personName={null}
    />
  );
}

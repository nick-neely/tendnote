"use client";

import { approveLoggedNoteAction, dismissLoggedNoteAction } from "@/app/actions/logged-notes";
import {
  ChatReviewActionCard,
  type ReviewActionLabels,
} from "@/components/chat-review-action-card";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";

/**
 * Interactive in-chat card for a freshly logged note that is linked to a resolved
 * person. Logged context is a lower trust tier than a tentative suggestion, so it
 * rests neutral (not clay) — but it is still actionable inline: the user can approve
 * it or dismiss it without leaving the conversation. Approving rides the automatic
 * extraction pipeline (it does not replace it): it pre-approves the note so whatever
 * the extractor distills is saved as confirmed memory, and approves anything already
 * extracted. Dismissing stops further extraction and clears its suggestions. A
 * personless note has nothing to attach a memory to, so the panel renders the
 * read-only logged card for those instead.
 */
export function ChatLoggedNoteCard({
  view,
  isNew = false,
}: {
  view: Extract<AssistantToolView, { kind: "saved_source_record" }> & { linkedPersonId: string };
  isNew?: boolean;
}) {
  const labels: ReviewActionLabels = {
    pendingWord: "You noted",
    resolvedWord: "Approved",
    resolvedChip: "Approved",
    primaryAction: "Approve",
    noun: "logged note",
    pendingFooter: "Logged context. Approve to keep the memories from it.",
    resolvedFooter: "Approved. Its memories are saved to your notebook.",
    dismissedFooter: "Dismissed. Not kept.",
    errorRecovery: "You can review it on the person's page.",
  };

  return (
    <ChatReviewActionCard
      content={view.content}
      isNew={isNew}
      kind="saved_source_record"
      labels={labels}
      onDismiss={() =>
        dismissLoggedNoteAction({
          sourceRecordId: view.sourceRecordId,
          personId: view.linkedPersonId,
        })
      }
      onResolve={() =>
        approveLoggedNoteAction({
          sourceRecordId: view.sourceRecordId,
          personId: view.linkedPersonId,
        })
      }
      pendingChipLabel="Logged"
      pendingTone="neutral"
      personHref={`/people/${view.linkedPersonId}`}
      personName={null}
    />
  );
}

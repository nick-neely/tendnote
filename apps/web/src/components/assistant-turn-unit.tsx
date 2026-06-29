"use client";

import { AssistantToolGroup } from "@/components/assistant-tool-group";
import { AssistantToolResult } from "@/components/assistant-tool-result";
import { ChatDraftCard } from "@/components/chat-draft-card";
import {
  ChatFollowupReviewCard,
  ChatFollowupReviewList,
} from "@/components/chat-followup-review-card";
import { ChatLoggedNoteCard } from "@/components/chat-logged-note-card";
import { ChatReviewCard, ChatReviewList } from "@/components/chat-review-card";
import type { AssistantTurnUnit } from "@/lib/eve/message-views";
import type { GroupableToolView } from "@/lib/eve/tool-result-view";

/**
 * Stable React key for a turn render unit. A group keys off its kind and first
 * member so it stays distinct from a lone result of the same kind; a single keys
 * off its own per-call id. Kept alongside the renderer so the key shape and the
 * dispatch never drift apart.
 */
export function turnUnitKey(messageId: string, unit: AssistantTurnUnit): string {
  if (unit.type === "group") {
    return `${messageId}:group:${unit.kind}:${unit.entries[0].toolCallId}`;
  }

  return `${messageId}:${unit.entry.toolCallId}`;
}

/**
 * Renders one tool-activity unit for an assistant turn. Same-kind durable saves
 * arrive pre-folded into a collapsed group (see groupTurnToolEntries); a single
 * unit routes to the interactive card the user can act on inline
 * (approve/dismiss, edit a draft, promote a logged note) when the result is
 * actionable, and otherwise to the read-only record of what Eve did.
 *
 * This is the assistant panel's one place that maps tool-result kinds to cards,
 * so new actionable result kinds are added here rather than in the panel shell.
 */
export function AssistantTurnUnitView({ unit }: { unit: AssistantTurnUnit }) {
  if (unit.type === "group") {
    return (
      <AssistantToolGroup
        isNew
        kind={unit.kind}
        views={unit.entries.map((entry) => entry.view as GroupableToolView)}
      />
    );
  }

  const { view } = unit.entry;

  if (view.kind === "suggested_memory_review") {
    return <ChatReviewCard isNew item={view} />;
  }

  if (view.kind === "suggested_memory_review_list") {
    return <ChatReviewList isNew view={view} />;
  }

  if (view.kind === "suggested_followup_review") {
    return <ChatFollowupReviewCard isNew item={view} />;
  }

  if (view.kind === "suggested_followup_review_list") {
    return <ChatFollowupReviewList isNew view={view} />;
  }

  // The draft card is interactive (inline WYSIWYG edit + copy), so it routes to
  // the client card rather than the presentational tool-result module.
  if (view.kind === "message_draft") {
    return <ChatDraftCard isNew view={view} />;
  }

  // A logged note linked to a resolved person can be promoted to a memory or
  // dismissed inline; a personless note has nothing to attach to, so it falls
  // through to the read-only logged card below.
  if (view.kind === "saved_source_record" && view.linkedPersonId) {
    return <ChatLoggedNoteCard isNew view={{ ...view, linkedPersonId: view.linkedPersonId }} />;
  }

  return <AssistantToolResult isNew view={view} />;
}

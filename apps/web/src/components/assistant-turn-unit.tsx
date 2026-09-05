"use client";

import type {
  GroupableToolView,
  InteractiveResultKind,
} from "@/components/assistant-results/registry";
import { AssistantToolGroup } from "@/components/assistant-tool-group";
import { AssistantToolResult } from "@/components/assistant-tool-result";
import {
  ChatApprovalBatchCard,
  ChatApprovalCard,
  ChatApprovalStatus,
} from "@/components/chat-approval-card";
import { ChatAssetReviewCard } from "@/components/chat-asset-review-card";
import { ChatDraftCard } from "@/components/chat-draft-card";
import {
  ChatFollowupReviewCard,
  ChatFollowupReviewList,
} from "@/components/chat-followup-review-card";
import {
  ChatGeneralActionReviewCard,
  ChatGeneralActionReviewList,
} from "@/components/chat-general-action-review-card";
import { ChatLoggedNoteCard } from "@/components/chat-logged-note-card";
import { ChatPersonUpdateCard } from "@/components/chat-person-update-card";
import { ChatReviewCard, ChatReviewList } from "@/components/chat-review-card";
import type { AssistantToolEntry, AssistantTurnCardUnit } from "@/lib/eve/message-views";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";

/**
 * The interactive-card adapter for the {@link InteractiveResultKind} set: the client
 * cards that carry an inline action affordance and import `server-only` review
 * mutations, so they live at this client seam rather than in the presentational
 * result-module registry. The map is *non-optional* over exactly the interactive
 * kinds, so the guarantee is real at compile time: a renderer for any other kind is a
 * type error, and an interactive kind missing its card fails to type-check here
 * rather than silently rendering nothing. A renderer that returns null (a personless
 * logged note) falls through to the read-only {@link AssistantToolResult}.
 */
const singleUnitRenderers: {
  [K in InteractiveResultKind]: (view: Extract<AssistantToolView, { kind: K }>) => React.ReactNode;
} = {
  updated_person: (view) =>
    view.update ? <ChatPersonUpdateCard view={view} update={view.update} /> : null,
  suggested_memory_review: (view) => <ChatReviewCard isNew item={view} />,
  suggested_memory_review_list: (view) => <ChatReviewList isNew view={view} />,
  suggested_followup_review: (view) => <ChatFollowupReviewCard isNew item={view} />,
  suggested_followup_review_list: (view) => <ChatFollowupReviewList isNew view={view} />,
  suggested_general_action_review: (view) => <ChatGeneralActionReviewCard isNew item={view} />,
  suggested_general_action_review_list: (view) => <ChatGeneralActionReviewList isNew view={view} />,
  // Asset facts Eve proposed: the Review tab's own group card, rendered in the
  // conversation. Accepting here and accepting in the queue are the same act (#198).
  asset_review_group: (view) => <ChatAssetReviewCard isNew review={view.review} />,
  // The draft card is interactive (inline WYSIWYG edit + copy), so it routes to the
  // client card rather than the presentational tool-result module.
  message_draft: (view) => <ChatDraftCard isNew view={view} />,
  // A logged note linked to a resolved person can be promoted to a memory or dismissed
  // inline; a personless note has nothing to attach to, so it returns null and falls
  // through to the read-only logged card.
  saved_source_record: (view) =>
    view.linkedPersonId ? (
      <ChatLoggedNoteCard isNew view={{ ...view, linkedPersonId: view.linkedPersonId }} />
    ) : null,
};

/**
 * The unit-kind half of the same map, over the card units rather than the
 * interactive result kinds - and total for the same reason: a new unit kind is a
 * type error here until it has a card, which is the guarantee a `default:` arm
 * silently gave up. The index needs one cast because TypeScript will not correlate
 * a key with its own narrowed member; the map's own entries are each checked
 * against exactly their unit.
 */
const unitRenderers: {
  [K in AssistantTurnCardUnit["type"]]: (
    unit: Extract<AssistantTurnCardUnit, { type: K }>,
  ) => React.ReactNode;
} = {
  group: (unit) => (
    <AssistantToolGroup
      isNew
      kind={unit.kind}
      views={unit.entries.map((entry) => entry.view as GroupableToolView)}
    />
  ),
  // A tool call Eve parked on the owner. This is the one card whose action resumes
  // the live turn instead of mutating independent domain state, so it reads
  // `respond` from the panel's session through context, not a server action.
  request: (unit) => <ChatApprovalCard isNew request={unit.request} />,
  // Several calls parked in the same breath: one card, one set of chrome, and a
  // separate decision for each of them.
  "request-batch": (unit) => <ChatApprovalBatchCard isNew requests={unit.requests} />,
  resolution: (unit) => <ChatApprovalStatus isNew resolution={unit.resolution} />,
  single: (unit) => <AssistantSingleUnitView entry={unit.entry} />,
};

/**
 * Renders one tool-activity unit for an assistant turn. Same-kind durable saves
 * arrive pre-folded into a collapsed group (see groupTurnToolEntries); a single
 * unit routes to the interactive card the user can act on inline
 * (approve/dismiss, edit a draft, promote a logged note) when the result is
 * actionable, and otherwise to the read-only record of what Eve did. A call parked
 * on the owner's approval, and the status it settles into, are cards too.
 *
 * This is the assistant panel's one place that maps tool-result kinds to cards,
 * so new actionable result kinds are added here rather than in the panel shell. The
 * one unit it does *not* own is the transient working line: that is panel chrome
 * shared with the composer's own "Thinking…" shimmer, so `AssistantTurnCardUnit`
 * excludes it and the panel renders it directly.
 */
export function AssistantTurnUnitView({ unit }: { unit: AssistantTurnCardUnit }) {
  const render = unitRenderers[unit.type] as (unit: AssistantTurnCardUnit) => React.ReactNode;
  return render(unit);
}

/**
 * One standalone tool result: the interactive card for the kinds that carry an inline
 * action, and the read-only record of what Eve did for everything else. Split from the
 * dispatch above so the unit map stays a statement about unit *kinds* and this stays
 * the one place a result kind is turned into a card.
 */
function AssistantSingleUnitView({ entry }: { entry: AssistantToolEntry }) {
  const { view } = entry;
  const renderers = singleUnitRenderers as Partial<
    Record<AssistantToolView["kind"], (view: AssistantToolView) => React.ReactNode>
  >;
  return renderers[view.kind]?.(view) ?? <AssistantToolResult isNew view={view} />;
}

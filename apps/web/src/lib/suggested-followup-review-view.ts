import type {
  SuggestedFollowupReviewComponent,
  SuggestedFollowupReviewResult,
} from "@tendnote/db/queries/followups";
import { type FollowupDueState, toFollowupView } from "./followup-view";

/**
 * Serializable, fixed-shape view of a suggested-follow-up review. The component
 * references persisted ids only (ADR 0028); review surfaces reload authoritative
 * records before any accept/edit/dismiss, so a refresh never desyncs an action.
 * Suggested follow-ups stay tentative until accepted.
 */
export type SuggestedFollowupReviewView = {
  component: SuggestedFollowupReviewComponent;
  /** Display name of the person the suggestion belongs to; null if unresolved. */
  personId: string | null;
  personName: string | null;
  followup: {
    id: string;
    reason: string;
    status: string;
    dueAtISO: string;
    dueAtDate: string;
    dueLabel: string;
    dueState: FollowupDueState;
  };
  source: {
    id: string;
    content: string;
    sourceType: string;
    capturedAt: string;
  } | null;
};

export function toSuggestedFollowupReviewView(
  result: SuggestedFollowupReviewResult,
  now: Date = new Date(),
): SuggestedFollowupReviewView {
  const followupView = toFollowupView(result.followup, now);

  return {
    component: result.component,
    personId: result.person?.id ?? result.followup.personId,
    personName: result.person?.displayName ?? null,
    followup: {
      id: followupView.id,
      reason: followupView.reason,
      status: followupView.status,
      dueAtISO: followupView.dueAtISO,
      dueAtDate: followupView.dueAtDate,
      dueLabel: followupView.dueLabel,
      dueState: followupView.dueState,
    },
    source: result.sourceRecord
      ? {
          id: result.sourceRecord.id,
          content: result.sourceRecord.content,
          sourceType: result.sourceRecord.sourceType,
          capturedAt: result.sourceRecord.createdAt.toISOString(),
        }
      : null,
  };
}

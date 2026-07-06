import type { SuggestedGeneralActionReviewResult } from "@tendnote/db/queries/general-actions";
import { type GeneralActionView, toGeneralActionView } from "./general-action-view";

/**
 * Serializable, fixed-shape view of a Suggested General Action review. The component
 * references persisted ids only (ADR 0028); review surfaces reload authoritative
 * records before any accept/edit/dismiss/ignore, so a refresh never desyncs a
 * proposal. The proposal stays tentative until accepted, so the embedded action view
 * carries the same editable metadata a durable Action shows — timing, recurrence,
 * Area, scope, people, asset hints — for a trustworthy at-a-glance review (ADR 0151).
 */
export type SuggestedGeneralActionReviewView = {
  component: SuggestedGeneralActionReviewResult["component"];
  action: GeneralActionView;
  /** The proposal's primary Area name, resolved where the surface knows it; else null. */
  areaName: string | null;
  source: {
    id: string;
    content: string;
    sourceType: string;
    capturedAt: string;
  } | null;
};

export function toSuggestedGeneralActionReviewView(
  result: SuggestedGeneralActionReviewResult,
  options: { now?: Date; callerUserId: string; areaNameById?: Map<string, string> },
): SuggestedGeneralActionReviewView {
  const action = toGeneralActionView(result.action, {
    now: options.now,
    callerUserId: options.callerUserId,
  });

  return {
    component: result.component,
    action,
    areaName: action.areaId ? (options.areaNameById?.get(action.areaId) ?? null) : null,
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

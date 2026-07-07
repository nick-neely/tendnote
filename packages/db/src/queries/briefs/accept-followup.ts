import type { BriefItem } from "@tendnote/domain";
import type {
  AcceptSuggestedFollowupInput,
  SuggestedFollowupReviewResult,
} from "../followups/types";
import type { BriefItemActionInput } from "./lifecycle";

export type AcceptBriefSuggestedFollowupInput = {
  ownerUserId: string;
  briefItemId: string;
  // Optional correction applied through the existing review mutation before accept.
  edit?: AcceptSuggestedFollowupInput["edit"];
};

export type AcceptBriefSuggestedFollowupResult = {
  briefItem: BriefItem;
  followup: SuggestedFollowupReviewResult;
};

/**
 * Decoupled dependencies for the brief follow-up acceptance bridge. The accept
 * delegate is the existing owner-scoped suggested-followup review mutation; this
 * service never re-implements the follow-up lifecycle.
 */
export type BriefSuggestedFollowupAcceptanceDeps = {
  getBriefItem: (input: { ownerUserId: string; briefItemId: string }) => Promise<BriefItem | null>;
  markBriefItemActed: (input: BriefItemActionInput) => Promise<BriefItem>;
  acceptSuggestedFollowup: (
    input: AcceptSuggestedFollowupInput,
  ) => Promise<SuggestedFollowupReviewResult>;
};

/**
 * Accepts a suggested-followup brief item by delegating to the existing
 * owner-scoped suggested-followup review mutation, then marking the brief item
 * acted-on (PRD #65, issue #71). It is a thin wrapper, not a second follow-up
 * lifecycle: the follow-up becomes or updates the real reminder through the shared
 * review path, and the brief item is only marked acted-on after that source action
 * succeeds. A failed acceptance propagates and leaves the brief item active.
 *
 * The accept and the acted-on mark are two writes across two stores, not one
 * transaction. If the mark fails after a successful accept, the follow-up is
 * already a real reminder and the brief item stays active; that is the deliberate
 * trade-off of keeping the two lifecycles separate, and the brief item can simply
 * be dismissed since the source action is done.
 */
export function createBriefSuggestedFollowupAcceptance(deps: BriefSuggestedFollowupAcceptanceDeps) {
  return {
    async acceptBriefSuggestedFollowup(
      input: AcceptBriefSuggestedFollowupInput,
    ): Promise<AcceptBriefSuggestedFollowupResult> {
      const item = await deps.getBriefItem({
        ownerUserId: input.ownerUserId,
        briefItemId: input.briefItemId,
      });

      if (!item) {
        throw new Error("Brief item not found.");
      }

      if (item.kind !== "suggested_followup") {
        throw new Error("Only suggested follow-up brief items can be accepted.");
      }

      const followupRef = item.sourceRefs.find((ref) => ref.kind === "followup");
      if (!followupRef) {
        throw new Error("This brief item has no follow-up to accept.");
      }

      // The suggested follow-up becomes a real reminder here, through the existing
      // shared review mutation. If it throws, we never reach the acted-on mark.
      const followup = await deps.acceptSuggestedFollowup({
        actorUserId: input.ownerUserId,
        followupId: followupRef.id,
        edit: input.edit,
      });

      const briefItem = await deps.markBriefItemActed({
        ownerUserId: input.ownerUserId,
        briefItemId: input.briefItemId,
      });

      return { briefItem, followup };
    },
  };
}

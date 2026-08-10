import type { AffectedScope } from "../affected-scopes";

/**
 * Everyone whose view of a Gift Plan a write could have changed.
 *
 * Three groups, and the last two are the ones that are easy to forget.
 *
 * The current audience is obvious. The *previous* audience matters because
 * narrowing a selection or protecting a subject is precisely the case where a
 * cached page must stop showing what it is showing — reconciling only the people
 * who can still see the plan would leave the removed reader holding it (ADR
 * 0219: caches may retain only what their current user could obtain now).
 *
 * The Surprise Subject is included for the same reason and one more: the moment
 * protection is applied is the moment their view has to lose the plan, and that
 * is the single most costly cache to get wrong, because an exposed surprise is
 * irreversibly lost (ADR 0216).
 *
 * Naming someone here reveals nothing — a reconciliation scope is an instruction
 * to re-read, and the re-read runs the proof again.
 */
export function affectedScopesForGiftPlan(input: {
  giftPlanId: string;
  ownerUserId: string;
  audienceUserIds?: readonly string[];
  previousAudienceUserIds?: readonly string[];
  surpriseSubjectUserIds?: readonly (string | null | undefined)[];
}): AffectedScope[] {
  const viewers = new Set<string>([
    input.ownerUserId,
    ...(input.audienceUserIds ?? []),
    ...(input.previousAudienceUserIds ?? []),
    ...(input.surpriseSubjectUserIds ?? []).filter((userId): userId is string => Boolean(userId)),
  ]);

  return [...viewers].flatMap((viewerUserId): AffectedScope[] => [
    { kind: "owner-collection", collection: "gift-plans", ownerUserId: viewerUserId },
    { kind: "viewer-collection", collection: "gift-plans", viewerUserId },
    {
      kind: "viewer-entity",
      entity: "gift-plan",
      entityId: input.giftPlanId,
      viewerUserId,
    },
  ]);
}

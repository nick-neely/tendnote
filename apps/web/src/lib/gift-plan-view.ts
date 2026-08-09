import type { GiftPlanDetail, GiftPlanWithContext } from "@tendnote/db/queries/gift-plans";
import type { GiftIdea, GiftPlanEvent, GiftPlanStatus, PrivacyScope } from "@tendnote/domain";
import { visibilityLabelForScope } from "@tendnote/domain/privacy";
import type { OwnerActionResult } from "@/lib/owner-action";

export type GiftPlanView = {
  id: string;
  revision: number;
  subjectName: string;
  occasion: string;
  occasionOn: string | null;
  /** "In 3 weeks", "Today", "Passed" — a quiet reference, never a countdown. */
  timingLabel: string | null;
  status: GiftPlanStatus;
  scope: PrivacyScope;
  visibilityLabel: string;
  householdName: string | null;
  /** The owner's own link home. Absent for a co-planner, by the seam, not the view. */
  subjectPersonId: string | null;
  surprise: boolean;
  owned: boolean;
  coPlannerCount: number;
  ideaCount: number;
  claimedIdeaCount: number;
};

export type GiftIdeaView = {
  id: string;
  revision: number;
  title: string;
  note: string | null;
  url: string | null;
  contributorLabel: string;
  mine: boolean;
  claimedByLabel: string | null;
  claimedByMe: boolean;
};

export type GiftPlanEventView = {
  id: string;
  at: string;
  summary: string;
};

export type GiftPlanDetailView = {
  plan: GiftPlanView;
  ideas: GiftIdeaView[];
  history: GiftPlanEventView[];
};

/** Names for the people a plan can attribute something to, resolved by the caller. */
export type GiftPlanPeopleLabels = {
  callerUserId: string;
  nameFor: (userId: string) => string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How near the occasion is, said plainly.
 *
 * No red, no "overdue", no count of days left once it has passed. A gift plan
 * that slipped is not a failure the product should press on; it just says the
 * date has gone by.
 */
function timingLabel(occasionOn: Date | null, now: Date): string | null {
  if (!occasionOn) return null;
  const days = Math.round(
    (Date.UTC(occasionOn.getUTCFullYear(), occasionOn.getUTCMonth(), occasionOn.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
      DAY_MS,
  );
  if (days < 0) return "Date has passed";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return occasionOn.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export function toGiftPlanView(
  plan: GiftPlanWithContext,
  people: GiftPlanPeopleLabels,
  now = new Date(),
): GiftPlanView {
  return {
    id: plan.id,
    revision: plan.revision,
    subjectName: plan.subjectName,
    occasion: plan.occasion,
    occasionOn: plan.occasionOn?.toISOString() ?? null,
    timingLabel: timingLabel(plan.occasionOn, now),
    status: plan.status,
    scope: plan.scope,
    visibilityLabel:
      plan.scope === "shared" && plan.sharedWithUserIds.length > 0
        ? `${plan.sharedWithUserIds.length} co-planner${plan.sharedWithUserIds.length === 1 ? "" : "s"}`
        : visibilityLabelForScope(plan.scope),
    householdName: plan.householdName,
    subjectPersonId: plan.subjectPersonId,
    surprise: plan.surpriseSubjectUserId !== null,
    owned: plan.ownerUserId === people.callerUserId,
    coPlannerCount: plan.sharedWithUserIds.length,
    ideaCount: plan.ideaCount,
    claimedIdeaCount: plan.claimedIdeaCount,
  };
}

export function toGiftIdeaView(idea: GiftIdea, people: GiftPlanPeopleLabels): GiftIdeaView {
  return {
    id: idea.id,
    revision: idea.revision,
    title: idea.title,
    note: idea.note,
    url: idea.url,
    contributorLabel:
      idea.contributorUserId === people.callerUserId
        ? "You"
        : people.nameFor(idea.contributorUserId),
    mine: idea.contributorUserId === people.callerUserId,
    claimedByLabel: idea.claimedByUserId
      ? idea.claimedByUserId === people.callerUserId
        ? "You"
        : people.nameFor(idea.claimedByUserId)
      : null,
    claimedByMe: idea.claimedByUserId === people.callerUserId,
  };
}

/**
 * Provenance as a sentence, never a raw id or an event name.
 *
 * Quiet and plan-local by design: it says what happened and who did it, and
 * nothing that would read as a fairness record or a score.
 */
function eventSummary(event: GiftPlanEvent, people: GiftPlanPeopleLabels): string {
  const actor = event.actorUserId
    ? event.actorUserId === people.callerUserId
      ? "You"
      : people.nameFor(event.actorUserId)
    : null;
  const who = actor ?? "Tendnote";
  switch (event.kind) {
    case "created":
      return `${who} started this plan`;
    case "edited":
      return `${who} updated the details`;
    case "audience_changed":
      return actor
        ? `${who} changed who can see this`
        : "This plan went private when household access ended";
    case "surprise_protected":
      return `${who} turned on surprise protection`;
    case "surprise_lifted":
      return `${who} turned off surprise protection`;
    case "idea_added":
      return `${who} added an idea`;
    case "idea_edited":
      return `${who} edited their idea`;
    case "idea_removed":
      return `${who} removed their idea`;
    case "idea_claimed":
      return `${who} said they'd handle an idea`;
    case "idea_released":
      return `${who} let an idea go`;
    case "celebrated":
      return `${who} marked this celebrated`;
    case "archived":
      return `${who} archived this plan`;
    case "reopened":
      return `${who} reopened this plan`;
    default:
      return `${who} made a change`;
  }
}

export function toGiftPlanDetailView(
  detail: GiftPlanDetail,
  people: GiftPlanPeopleLabels,
  now = new Date(),
): GiftPlanDetailView {
  return {
    plan: toGiftPlanView(detail.plan, people, now),
    ideas: detail.ideas.map((idea) => toGiftIdeaView(idea, people)),
    history: detail.events.map((event) => ({
      id: event.id,
      at: event.createdAt.toISOString(),
      summary: eventSummary(event, people),
    })),
  };
}

export type GiftPlanMutationResult = OwnerActionResult<GiftPlanView>;
export type GiftIdeaMutationResult = OwnerActionResult<GiftIdeaView>;

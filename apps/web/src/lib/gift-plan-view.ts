import type { GiftPlanDetail, GiftPlanWithContext } from "@tendnote/db/queries/gift-plans";
import type { GiftIdea, GiftPlanEvent, GiftPlanStatus, PrivacyScope } from "@tendnote/domain";
import { giftPlanAcceptsCommitments } from "@tendnote/domain";
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
  /** "Celebrated" / "Archived", or `null` while the plan is simply under way. */
  statusLabel: string | null;
  /**
   * Whether the plan still takes new ideas and claims. Read from the domain, so
   * a control that appears and a write that succeeds cannot disagree.
   */
  acceptsCommitments: boolean;
  /** The plain-language reason contributions are closed, when they are. */
  closedReason: string | null;
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

/**
 * Names for the people a plan can attribute something to, resolved by the caller.
 *
 * A plain record rather than a `nameFor` callback because this crosses a
 * `"use cache"` boundary. A function argument to a cached function becomes a
 * temporary Client Reference, and calling one on the server throws — which it
 * did for every viewer who was not the sole contributor, because the caller's
 * own name is answered by the `"You"` branch and never reaches the lookup. The
 * page therefore failed exactly when a household gift plan had more than one
 * person in it, which is the only case it exists for.
 */
export type GiftPlanPeopleLabels = {
  callerUserId: string;
  names: Readonly<Record<string, string>>;
};

/**
 * The one fallback for a person a plan can name but the roster cannot.
 *
 * A departed member, a removed one, or an actor from before the caller could
 * see the plan all land here. Never a raw id, and never a blank: an unnamed
 * actor is still an actor, and the sentence has to survive them leaving.
 */
export function giftPlanMemberName(people: GiftPlanPeopleLabels, userId: string): string {
  return people.names[userId] ?? "Someone in your household";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `null` for `active`, because a plan under way is the ordinary case and a chip
 * saying so on every row would be noise. The two states that change what the
 * page can do are the two that get named.
 */
const GIFT_PLAN_STATUS_LABELS: Record<GiftPlanStatus, string | null> = {
  active: null,
  celebrated: "Celebrated",
  archived: "Archived",
};

/**
 * Why contributions are closed, in the words the reader needs: what happened,
 * and the one move that reopens it. Never a bare disabled control.
 */
const GIFT_PLAN_CLOSED_REASONS: Record<GiftPlanStatus, string | null> = {
  active: null,
  celebrated: "This plan is marked celebrated. Reopen it to add or claim ideas.",
  archived: "This plan is archived. Reopen it to make changes.",
};

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
    statusLabel: GIFT_PLAN_STATUS_LABELS[plan.status],
    acceptsCommitments: giftPlanAcceptsCommitments(plan),
    closedReason: GIFT_PLAN_CLOSED_REASONS[plan.status],
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
        : giftPlanMemberName(people, idea.contributorUserId),
    mine: idea.contributorUserId === people.callerUserId,
    claimedByLabel: idea.claimedByUserId
      ? idea.claimedByUserId === people.callerUserId
        ? "You"
        : giftPlanMemberName(people, idea.claimedByUserId)
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
      : giftPlanMemberName(people, event.actorUserId)
    : null;
  const who = actor ?? "Tendnote";
  // The subject of these sentences is "You" as often as it is a name, and a
  // third-person possessive written for the name case reads as a mistake about
  // the reader when it is not — "You said they'd handle an idea" about the idea
  // they just claimed themselves.
  const self = event.actorUserId !== null && event.actorUserId === people.callerUserId;
  const their = self ? "your" : "their";
  const theyWould = self ? "you'd" : "they'd";
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
      return `${who} edited ${their} idea`;
    case "idea_removed":
      return `${who} removed ${their} idea`;
    case "idea_claimed":
      return `${who} said ${theyWould} handle an idea`;
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

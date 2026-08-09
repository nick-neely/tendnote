import { z } from "zod";
import { privacyScopeSchema } from "./privacy";

/**
 * Where a Gift Plan is in the finite act of planning one celebration.
 *
 * Three states and no backlog: a plan is being worked on, the occasion has
 * happened, or it has been put away. There is deliberately no "purchased",
 * "delivered", or "cancelled" — those belong to a registry or a shopping list,
 * which this is not (docs/phase-8/household-gift-ideas-and-birthday-planning.md).
 */
export const giftPlanStatusSchema = z.enum(["active", "celebrated", "archived"]);
export type GiftPlanStatus = z.infer<typeof giftPlanStatusSchema>;

/**
 * The plan-local provenance vocabulary.
 *
 * Quiet and plan-scoped: who started it, who contributed, who claimed, what the
 * owner changed. It is not a household activity feed, a fairness record, or a
 * participation score, so there is no event here for reading, opening, or
 * arriving — only for a deliberate act on this plan.
 */
export const giftPlanEventKindSchema = z.enum([
  "created",
  "edited",
  "audience_changed",
  "surprise_protected",
  "surprise_lifted",
  "idea_added",
  "idea_edited",
  "idea_removed",
  "idea_claimed",
  "idea_released",
  "celebrated",
  "archived",
  "reopened",
]);
export type GiftPlanEventKind = z.infer<typeof giftPlanEventKindSchema>;

const planText = z.string().trim();

export const giftPlanSchema = z.object({
  id: z.uuid(),
  ownerUserId: z.string().min(1),
  /**
   * The deliberately entered, plan-facing name of the person being celebrated.
   *
   * A snapshot, not a projection of a Person record: a co-planner sees the name
   * the owner typed here and nothing else about that person. The optional
   * `subjectPersonId` below is the owner's own convenience link and confers no
   * access to the Person, their birthday, memories, or Assets.
   */
  subjectName: planText.min(1).max(120),
  occasion: planText.min(1).max(120),
  /** When the celebration is, if the owner named a date. Never edits a Person's birthday. */
  occasionOn: z.date().nullable(),
  subjectPersonId: z.uuid().nullable(),
  /**
   * The active Household Member this plan is a surprise for.
   *
   * The authoritative exclusion of ADR 0216. It is one user id rather than a
   * list because a Gift Plan celebrates one person; a deny-list here would be
   * the generic visibility deny-list the ADR explicitly refuses to invent.
   */
  surpriseSubjectUserId: z.string().min(1).nullable(),
  status: giftPlanStatusSchema,
  scope: privacyScopeSchema,
  householdId: z.uuid().nullable(),
  lastActorUserId: z.string().min(1).nullable(),
  /**
   * A counter bumped by every write, and the token optimistic concurrency
   * compares.
   *
   * Deliberately not `updatedAt`. A timestamp has millisecond resolution, so two
   * edits landing in the same millisecond compare equal and the second silently
   * overwrites the first — which is precisely the race the check exists to
   * catch. A counter cannot collide.
   */
  revision: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type GiftPlan = z.infer<typeof giftPlanSchema>;

export const createGiftPlanSchema = giftPlanSchema
  .omit({
    id: true,
    status: true,
    lastActorUserId: true,
    revision: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    id: z.uuid().optional(),
    occasionOn: z.date().nullable().default(null),
    subjectPersonId: z.uuid().nullable().default(null),
    surpriseSubjectUserId: z.string().min(1).nullable().default(null),
    scope: privacyScopeSchema.default("private"),
    householdId: z.uuid().nullable().default(null),
  });
export type CreateGiftPlanInput = z.input<typeof createGiftPlanSchema>;

/**
 * A partial patch with no defaults, so an absent field means "leave it alone"
 * rather than "reset it". Strict, so a typo becomes a parse failure instead of a
 * silently ignored edit.
 */
export const giftPlanUpdateSchema = giftPlanSchema
  .pick({
    subjectName: true,
    occasion: true,
    occasionOn: true,
    subjectPersonId: true,
    surpriseSubjectUserId: true,
    status: true,
    scope: true,
    householdId: true,
    lastActorUserId: true,
  })
  .partial()
  .strict();
export type GiftPlanPatch = z.infer<typeof giftPlanUpdateSchema>;

export const giftIdeaSchema = z.object({
  id: z.uuid(),
  giftPlanId: z.uuid(),
  /** Whoever entered it. Only they may edit or remove it, however wide the plan. */
  contributorUserId: z.string().min(1),
  title: planText.min(1).max(200),
  note: planText.max(4_000).nullable(),
  url: planText.max(2_000).nullable(),
  claimedByUserId: z.string().min(1).nullable(),
  claimedAt: z.date().nullable(),
  lastActorUserId: z.string().min(1).nullable(),
  /** See {@link giftPlanSchema}'s `revision`: a counter, because timestamps collide. */
  revision: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type GiftIdea = z.infer<typeof giftIdeaSchema>;

export const createGiftIdeaSchema = giftIdeaSchema
  .omit({
    id: true,
    claimedByUserId: true,
    claimedAt: true,
    lastActorUserId: true,
    revision: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    id: z.uuid().optional(),
    note: planText.max(4_000).nullable().default(null),
    url: planText.max(2_000).nullable().default(null),
  });
export type CreateGiftIdeaInput = z.input<typeof createGiftIdeaSchema>;

export const giftIdeaUpdateSchema = giftIdeaSchema
  .pick({
    title: true,
    note: true,
    url: true,
    claimedByUserId: true,
    claimedAt: true,
    lastActorUserId: true,
  })
  .partial()
  .strict();
export type GiftIdeaPatch = z.infer<typeof giftIdeaUpdateSchema>;

export const giftPlanEventSchema = z.object({
  id: z.uuid(),
  giftPlanId: z.uuid(),
  kind: giftPlanEventKindSchema,
  actorUserId: z.string().min(1).nullable(),
  detailJson: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
});
export type GiftPlanEvent = z.infer<typeof giftPlanEventSchema>;

/** The family's user-safe failure. Its message is rendered inline by surfaces. */
export class GiftPlanValidationError extends Error {
  override name = "GiftPlanValidationError";
}

/**
 * A write that lost a race, carrying what the surface needs to let the person
 * decide.
 *
 * The current value and the responsible actor travel on the error because the
 * rule is "preserve the draft, show what is there now, make them choose" — a
 * bare failure would leave the surface guessing, and re-reading afterwards would
 * be a second race.
 */
export class GiftPlanConflictError extends Error {
  override name = "GiftPlanConflictError";

  constructor(
    message: string,
    readonly conflict: {
      currentValue: string | null;
      actorUserId: string | null;
      /** What the writer must carry to retry, so the retry is not a third race. */
      revision: number;
    },
  ) {
    super(message);
  }
}

/**
 * The Surprise Subject as the Household Authorization Proof wants it: a plain
 * list of user ids denied every operation on this record (ADR 0216, ADR 0219).
 *
 * This is the single place the exclusion becomes a fact the proof can read, and
 * it is derived from the stored column rather than passed in, so no route, tool,
 * job, or cached page can hand over a plan whose protection has been dropped on
 * the way. An unprotected plan yields an empty list, which the proof's exclusion
 * gate treats as "nothing to exclude" rather than "exclusion not checked".
 */
export function giftPlanExclusions(
  plan: Pick<GiftPlan, "surpriseSubjectUserId">,
): readonly string[] {
  return plan.surpriseSubjectUserId ? [plan.surpriseSubjectUserId] : [];
}

/**
 * Whether the owner may name this person as the plan's Surprise Subject.
 *
 * Two refusals, both structural. Naming yourself would lock you out of your own
 * plan, because the proof's exclusion gate denies everyone it names including
 * the record's owner — failing closed is right there, but a product that lets
 * you walk into it is wrong. And the protection exists only for an active
 * Household Member (ADR 0216): for anyone else the selected co-planner audience
 * is already sufficient, and a subject with no membership has nowhere to see the
 * plan from.
 */
export function assertSurpriseSubjectEligible(input: {
  ownerUserId: string;
  surpriseSubjectUserId: string;
  activeMemberUserIds: readonly string[];
}): void {
  if (input.surpriseSubjectUserId === input.ownerUserId) {
    throw new GiftPlanValidationError(
      "A plan can't be a surprise for the person keeping it. Choose the household member you're planning for.",
    );
  }
  if (!input.activeMemberUserIds.includes(input.surpriseSubjectUserId)) {
    throw new GiftPlanValidationError(
      "Surprise protection is for someone in your household. Choose an active member.",
    );
  }
}

/**
 * Keeps the Surprise Subject out of the selected co-planner audience.
 *
 * The proof would refuse them anyway — the exclusion gate runs before the
 * audience gate and cannot be reached past. This exists so the mistake is
 * impossible to *make*, rather than merely harmless once made: an owner who
 * thought they had shared a plan with someone should be told, not quietly
 * overruled (ADR 0216: an allow-list alone cannot prevent an accidental later
 * addition).
 */
export function assertAudienceExcludesSurpriseSubject(input: {
  surpriseSubjectUserId: string | null;
  selectedUserIds: readonly string[];
}): void {
  if (input.surpriseSubjectUserId && input.selectedUserIds.includes(input.surpriseSubjectUserId)) {
    throw new GiftPlanValidationError(
      "You can't add the person this is a surprise for as a co-planner.",
    );
  }
}

/** The selected audience with the Surprise Subject removed, for a fail-closed write. */
export function audienceWithoutSurpriseSubject(input: {
  surpriseSubjectUserId: string | null;
  selectedUserIds: readonly string[];
}): string[] {
  return input.selectedUserIds.filter((userId) => userId !== input.surpriseSubjectUserId);
}

/** Archived plans are read-only history; celebrated ones can still be tidied. */
export function assertGiftPlanOpen(plan: Pick<GiftPlan, "status">): void {
  if (plan.status === "archived") {
    throw new GiftPlanValidationError("This plan is archived. Reopen it to make changes.");
  }
}

const GIFT_PLAN_TRANSITIONS: Record<GiftPlanStatus, readonly GiftPlanStatus[]> = {
  active: ["celebrated", "archived"],
  celebrated: ["active", "archived"],
  archived: ["active"],
};

export function resolveGiftPlanTransition(input: {
  from: GiftPlanStatus;
  to: GiftPlanStatus;
}): GiftPlanEventKind {
  if (!GIFT_PLAN_TRANSITIONS[input.from].includes(input.to)) {
    throw new GiftPlanValidationError("That isn't a change this plan can make right now.");
  }
  if (input.to === "archived") return "archived";
  if (input.to === "celebrated") return "celebrated";
  return "reopened";
}

/**
 * Contribution authority, which is not the plan's authority.
 *
 * The owner governs the plan — its subject, occasion, audience, protection, and
 * lifecycle. They do not govern what a co-planner wrote inside it. Attribution
 * survives a departure precisely because it was never the owner's to edit.
 */
export function assertGiftIdeaContributor(input: {
  idea: Pick<GiftIdea, "contributorUserId">;
  actorUserId: string;
}): void {
  if (input.idea.contributorUserId !== input.actorUserId) {
    throw new GiftPlanValidationError("Only the person who added an idea can change or remove it.");
  }
}

export type GiftIdeaClaimIntent = "claim" | "release";

/**
 * The reversible self-claim: "I'll handle this."
 *
 * Self only, in both directions. No one may claim an idea for someone else and
 * no one may release another person's claim, so the claim identifies a member
 * and a time to the other co-planners and never becomes an assignment, a
 * reminder, a purchase record, or a measure of who is doing more.
 *
 * The already-claimed case is a conflict rather than a validation failure
 * because the caller did nothing wrong: they are told who has it and may pick a
 * different idea. The atomicity itself is the store's — this decides, the
 * conditional write enforces.
 */
export function resolveGiftIdeaClaim(input: {
  idea: Pick<GiftIdea, "claimedByUserId" | "title" | "revision">;
  actorUserId: string;
  intent: GiftIdeaClaimIntent;
}): { claimedByUserId: string | null } {
  const { idea, actorUserId } = input;
  if (input.intent === "claim") {
    if (idea.claimedByUserId === actorUserId) {
      return { claimedByUserId: actorUserId };
    }
    if (idea.claimedByUserId) {
      throw new GiftPlanConflictError("Someone else already said they'd handle this one.", {
        currentValue: idea.title,
        actorUserId: idea.claimedByUserId,
        revision: idea.revision,
      });
    }
    return { claimedByUserId: actorUserId };
  }

  if (idea.claimedByUserId && idea.claimedByUserId !== actorUserId) {
    throw new GiftPlanValidationError("Only the person who claimed an idea can let it go.");
  }
  return { claimedByUserId: null };
}

/**
 * Optimistic concurrency for plan and idea edits.
 *
 * The expected revision is the one the surface rendered from. A mismatch means
 * the record moved underneath the draft, and the answer is never a silent
 * overwrite: the writer keeps what they typed and is shown what is there now,
 * plus the revision they would be replacing.
 *
 * An absent expectation is an explicit replace. That is the escape hatch the
 * conflict copy offers ("replace it with mine"), and it is why the check is not
 * simply mandatory: a writer who has *seen* the current value is allowed to
 * overwrite it deliberately.
 */
export function assertGiftRecordFresh(input: {
  expectedRevision: number | null | undefined;
  current: { revision: number; lastActorUserId: string | null };
  currentValue: string | null;
  message: string;
}): void {
  if (input.expectedRevision === null || input.expectedRevision === undefined) return;
  if (input.expectedRevision === input.current.revision) return;
  throw new GiftPlanConflictError(input.message, {
    currentValue: input.currentValue,
    actorUserId: input.current.lastActorUserId,
    revision: input.current.revision,
  });
}

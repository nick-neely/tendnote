import type {
  CreateGiftIdeaInput,
  CreateGiftPlanInput,
  GiftIdea,
  GiftIdeaPatch,
  GiftPlan,
  GiftPlanEvent,
  GiftPlanEventKind,
  GiftPlanPatch,
  GiftPlanStatus,
} from "@tendnote/domain";
import type { HouseholdStore } from "../households/types";

/**
 * The record half of the Gift Plan seam: rows in, rows out, no policy.
 *
 * The one place policy leaks into storage is {@link GiftPlanStore.listGiftPlanCandidates},
 * which applies the household visibility predicate *and* the Surprise Subject
 * exclusion in SQL. That is a pre-filter, not the decision: every row it returns
 * is still proved before it reaches a caller. It carries the exclusion anyway so
 * a protected plan never leaves the database on a read by the person it is a
 * surprise for — defence in depth, in the two languages the rule has to hold in.
 */
export type GiftPlanStore = {
  createGiftPlan: (input: CreateGiftPlanInput) => Promise<GiftPlan>;
  getGiftPlanById: (input: { giftPlanId: string }) => Promise<GiftPlan | null>;
  /**
   * The rows this caller could plausibly see, narrowed in storage. Ordered
   * newest-first by the occasion the plan is for, then by when it was made.
   */
  listGiftPlanCandidates: (input: {
    callerUserId: string;
    statuses?: readonly GiftPlanStatus[];
    /** A plain-text match over the subject name and occasion. Absent means "all". */
    query?: string;
    limit?: number;
  }) => Promise<GiftPlan[]>;
  /** Every plan in one household, for the access-ended sweep. Never a caller read. */
  listGiftPlansInHousehold: (input: {
    householdId: string;
    ownerUserId?: string;
  }) => Promise<GiftPlan[]>;
  updateGiftPlan: (input: { giftPlanId: string; patch: GiftPlanPatch }) => Promise<GiftPlan>;
  deleteGiftPlan: (input: { giftPlanId: string }) => Promise<void>;

  createGiftIdea: (input: CreateGiftIdeaInput) => Promise<GiftIdea>;
  getGiftIdeaById: (input: { giftIdeaId: string }) => Promise<GiftIdea | null>;
  listGiftIdeas: (input: { giftPlanId: string }) => Promise<GiftIdea[]>;
  /**
   * Idea and claim counts for a bounded set of plans, in one read.
   *
   * Counts live beside the plans they belong to rather than being fetched per
   * row so a listing costs a fixed number of queries — and so the count and the
   * plan can never come from different moments, which is how a number ends up
   * describing a record its reader was refused.
   */
  countGiftIdeasForPlans: (input: {
    giftPlanIds: readonly string[];
  }) => Promise<Array<{ giftPlanId: string; ideaCount: number; claimedIdeaCount: number }>>;
  updateGiftIdea: (input: { giftIdeaId: string; patch: GiftIdeaPatch }) => Promise<GiftIdea>;
  deleteGiftIdea: (input: { giftIdeaId: string }) => Promise<void>;
  /**
   * Takes the claim only if nobody holds it, in one statement.
   *
   * `null` means someone got there first — the caller re-reads to find out who,
   * and is offered a different idea. Deciding in application code and writing
   * afterwards would leave exactly the window where two co-planners both buy the
   * blanket, which is the entire point of the claim.
   */
  claimGiftIdeaIfUnclaimed: (input: {
    giftIdeaId: string;
    claimantUserId: string;
    at: Date;
  }) => Promise<GiftIdea | null>;

  createGiftPlanEvent: (input: {
    giftPlanId: string;
    kind: GiftPlanEventKind;
    actorUserId: string | null;
    detailJson?: Record<string, unknown>;
  }) => Promise<GiftPlanEvent>;
  listGiftPlanEvents: (input: { giftPlanId: string; limit?: number }) => Promise<GiftPlanEvent[]>;
};

/**
 * The household reads and writes the seam performs, and nothing more.
 *
 * Narrowed from `HouseholdStore` rather than taking the whole thing so the
 * capabilities are legible: this module reads memberships and the share
 * registry, and rewrites one record's shares. It cannot touch a membership, a
 * role, an invitation, or a household's status.
 */
export type GiftPlanHouseholdStore = Pick<
  HouseholdStore,
  | "getHouseholdWorkspace"
  | "getHouseholdMembership"
  | "listHouseholdMemberships"
  | "listActiveHouseholdMembershipsForUser"
  | "createHouseholdRecordShare"
  | "listHouseholdRecordShares"
  | "listHouseholdRecordSharesForRecords"
  | "deleteHouseholdRecordShares"
>;

export type GiftPlanLifecycleStore = {
  plans: GiftPlanStore;
  households: GiftPlanHouseholdStore;
};

/**
 * A plan as a caller is allowed to see it.
 *
 * `subjectPersonId` is `null` for anyone but the owner: the plan may link to the
 * underlying Person for its owner's convenience, and that link never travels to
 * a co-planner, who gets the typed subject name and nothing else.
 *
 * The counts are computed from the same proved read that produced the plan, so
 * there is no path by which a number can describe a record its reader may not
 * see.
 */
export type GiftPlanWithContext = GiftPlan & {
  householdName: string | null;
  sharedWithUserIds: string[];
  ideaCount: number;
  claimedIdeaCount: number;
};

export type GiftPlanDetail = {
  plan: GiftPlanWithContext;
  ideas: GiftIdea[];
  events: GiftPlanEvent[];
};

import type {
  HouseholdEventPlan,
  HouseholdEventPlanLink,
  HouseholdEventPlanLinkKind,
  HouseholdEventPlanStatus,
  PrivacyScope,
} from "@tendnote/domain";

export type HouseholdEventPlanWrite = {
  title: string;
  details: string | null;
  plannedFor: Date | null;
  calendarConnectionId: string | null;
  calendarId: string | null;
  calendarProviderEventId: string | null;
};

export type HouseholdEventPlanStore = {
  listPlans: (input: {
    householdId: string;
    status?: HouseholdEventPlanStatus;
  }) => Promise<HouseholdEventPlan[]>;
  getPlan: (input: { planId: string }) => Promise<HouseholdEventPlan | null>;
  createPlan: (
    input: HouseholdEventPlanWrite & {
      householdId: string;
      actorUserId: string;
      at: Date;
    },
  ) => Promise<HouseholdEventPlan>;
  /**
   * Applies a material write fenced on `expectedVersion`, bumping the version
   * and the last actor in the same statement.
   *
   * `null` means the fence did not hold. The fence lives in the store rather
   * than in a read-compare-write above it because a comparison performed outside
   * the write is not a fence: two members can both read version 3, both find it
   * current, and both write. Here the database decides, once.
   */
  applyPlanWrite: (input: {
    planId: string;
    expectedVersion: number;
    actorUserId: string;
    at: Date;
    patch: Partial<HouseholdEventPlanWrite> & {
      status?: HouseholdEventPlanStatus;
      archivedAt?: Date | null;
    };
  }) => Promise<HouseholdEventPlan | null>;
  listLinks: (input: { planIds: readonly string[] }) => Promise<HouseholdEventPlanLink[]>;
  createLink: (input: {
    planId: string;
    linkKind: HouseholdEventPlanLinkKind;
    recordId: string;
    linkedByUserId: string;
    at: Date;
  }) => Promise<HouseholdEventPlanLink>;
  deleteLink: (input: { planId: string; linkId: string }) => Promise<boolean>;
};

/**
 * The facts a link target contributes to its own authorization, plus the one
 * word a proved link is allowed to show.
 *
 * A Plan does not know what a Follow-Up is, and must not: it reads the target's
 * stored ownership and audience and hands them to the Household Authorization
 * Proof, which is the only thing entitled to decide (ADR 0219).
 *
 * There is no `sensitivity` here because none of the three linkable families
 * stores one, so the proof's `normal` default is the target's actual fact rather
 * than a fact quietly dropped. A family that gains one has to widen this port at
 * the same time, or its restricted records would be proved as ordinary ones.
 *
 * `title` is the only content that crosses this port, and it is here because a
 * link with no title could only be rendered as an id. It is read before the
 * proof and kept only for a link the proof grants, so a refused link leaks
 * nothing - not the title, and not a placeholder standing where one would be.
 * Nothing of the record's body belongs here.
 */
export type HouseholdEventPlanLinkTargetFacts = {
  /**
   * Null when the target belongs to the Household Workspace rather than to a
   * member - a household-native Saved Item is the first linkable record with
   * that shape (#385, ADR 0214). The Proof already reads a null owner, so it
   * crosses this port unchanged rather than being papered over with a
   * placeholder id nobody holds.
   */
  ownerUserId: string | null;
  scope: PrivacyScope;
  householdId: string | null;
  title: string;
};

/** A link that survived the reader's proof: the stored row, plus its target's name. */
export type HouseholdEventPlanProvedLink = HouseholdEventPlanLink & {
  title: string;
};

export type HouseholdEventPlanLinkTargetStore = {
  readFacts: (input: {
    linkKind: HouseholdEventPlanLinkKind;
    recordId: string;
  }) => Promise<HouseholdEventPlanLinkTargetFacts | null>;
};

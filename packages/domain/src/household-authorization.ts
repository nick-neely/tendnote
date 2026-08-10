import { z } from "zod";
import {
  type ActiveHouseholdAccess,
  canUseSensitiveContext,
  type PrivacyScope,
  type Sensitivity,
  scopedRecordAudience,
} from "./privacy";

/**
 * The operations a Household Authorization Proof can be asked for.
 *
 * Deliberately operations rather than a read/write pair or a role: changing a
 * record's audience is not the same authority as editing its content, and the
 * proof is asked for the exact thing about to happen (ADR 0219).
 */
export const householdOperationSchema = z.enum([
  "view",
  "progress",
  "update",
  "change_audience",
  "archive",
]);
export type HouseholdOperation = z.infer<typeof householdOperationSchema>;

/**
 * The operations that need authority over the record, not merely a place in its
 * audience.
 *
 * `progress` is deliberately absent, and that absence is the rule rather than an
 * oversight. Reporting that a shared thing was done or undone is a truthful,
 * reversible statement about the world that anyone who can see the record is in
 * a position to make — "I picked up the milk" — whereas re-authoring, re-addressing,
 * or archiving someone's record is a decision that was never the audience's to
 * take (#383). So `progress` passes the audience gate and stops there, while
 * every other mutation falls to the owner unless the workspace owns the record.
 */
const MUTATIONS: ReadonlySet<HouseholdOperation> = new Set<HouseholdOperation>([
  "update",
  "change_audience",
  "archive",
]);

export type HouseholdAuthorizationSubject = {
  /** The record family, so a proof for one kind can never cover another. */
  kind: string;
  id: string;
  ownerUserId: string;
  scope: PrivacyScope;
  householdId: string | null;
  /** The selected active members for a `shared` scope. */
  audienceUserIds?: readonly string[];
  /** Defaults to `member_owned`; see {@link HouseholdRecordOwnership}. */
  ownership?: HouseholdRecordOwnership;
  /** Defaults to `active`; see {@link HouseholdRecordLifecycle}. */
  lifecycle?: HouseholdRecordLifecycle;
  /** Defaults to `normal`. Independent of audience, never derived from it. */
  sensitivity?: Sensitivity;
  /**
   * The domain's own exclusion list — a Gift Plan's Surprise Subject being the
   * motivating case. Whoever is named here is denied every operation, including
   * the record's owner: a domain that names its own owner has made a mistake,
   * and locking out is the safe direction to fail. #389 is the first producer.
   */
  excludedUserIds?: readonly string[];
};

/**
 * Who the record belongs to, which is not the same question as who can see it.
 *
 * A `member_owned` record keeps its owner's authority no matter how wide its
 * audience gets: widening visibility never transfers the right to edit, archive,
 * or re-address it. A `household_native` record belongs to the workspace, so
 * every active member holds symmetric authority over it and no creator or
 * Household Owner privilege applies (see CONTEXT.md, Household-Native Record).
 *
 * `household_native` is written by General Actions and Routines (#383), the
 * first domain to earn the full Phase Eight collaboration contract. Ownership
 * form is a stored fact on the record, never derived from scope: a member-owned
 * Action at `household` scope and a household-native one look identical to the
 * audience rule and could not be told apart without it.
 */
export type HouseholdRecordOwnership = "member_owned" | "household_native";

/**
 * Whether the record still exists for authorization purposes.
 *
 * `ended` covers deletion, household dissolution, and any other terminal state
 * that should read as "there is nothing here" — it denies every operation. It is
 * deliberately not an archive flag: whether an archived or completed record can
 * still be edited is each domain's own lifecycle rule, not a Household privacy
 * question, and answering it here would let this module quietly overrule domains
 * it knows nothing about.
 */
export type HouseholdRecordLifecycle = "active" | "ended";

/**
 * Why the caller wants it. `ambient` covers everything the caller did not point
 * at: orientation context, household composition, proactive suggestions,
 * ranked retrieval, reminder previews, notifications. Restricted content is
 * excluded from all of it and reachable only through a direct, targeted request.
 *
 * Read paths default to `direct` because a caller opening a record has pointed
 * at it. The surfaces that must pass `ambient` are the assistant and proactive
 * ones in #390, and the Gift Plan surfaces in #389 pair it with an exclusion.
 */
export type HouseholdRequestPurpose = "direct" | "ambient";

export type HouseholdAuthorizationRequest = {
  callerUserId: string;
  operation: HouseholdOperation;
  subject: HouseholdAuthorizationSubject;
  /**
   * The caller's *own* active memberships, read at the moment of the call.
   *
   * The caller's list rather than the household's roster, so no argument here
   * can assert standing in a household the caller was never in, and a departure
   * takes effect on the next read rather than whenever a roster cache expires.
   */
  callerActiveMemberships: readonly ActiveHouseholdAccess[];
  purpose?: HouseholdRequestPurpose;
};

/**
 * Why a proof was refused. Audit and security-telemetry only — it is never
 * rendered, mapped to a message, or branched on by a surface. Every denial has
 * exactly one caller-visible outcome (ADR 0219).
 */
export type HouseholdAuthorizationDenial =
  | "no_caller"
  | "record_ended"
  | "domain_exclusion"
  | "not_owner"
  | "no_household"
  | "not_active_member"
  | "not_in_audience"
  | "restricted_requires_direct_request"
  | "not_record_authority";

export type HouseholdAuthorizationGrant = {
  authorized: true;
  callerUserId: string;
  operation: HouseholdOperation;
  subjectKind: string;
  subjectId: string;
  householdId: string | null;
  ownership: HouseholdRecordOwnership;
  /** The form of standing the grant rests on, recorded as its evidence. */
  via: "owner" | "household_audience" | "selected_audience" | "household_authority";
};

export type HouseholdAuthorizationRefusal = {
  authorized: false;
  denial: HouseholdAuthorizationDenial;
};

export type HouseholdAuthorizationProof =
  | HouseholdAuthorizationGrant
  | HouseholdAuthorizationRefusal;

function refuse(denial: HouseholdAuthorizationDenial): HouseholdAuthorizationRefusal {
  return { authorized: false, denial };
}

/**
 * Decides one caller's one operation on one record.
 *
 * The gates run in a fixed order and each one can only deny: existence, then the
 * domain's own exclusions, then audience, then sensitivity, then the authority
 * the operation itself needs. Nothing short-circuits past a later gate — in
 * particular being the record's owner does not skip the exclusion or lifecycle
 * checks — so adding a gate cannot accidentally leave a path uncovered.
 *
 * The order is not ADR 0219's; that ADR lists what a proof evaluates, not a
 * sequence. Because every gate can only deny and the denial reason never reaches
 * the caller, the order is invisible from outside — so exclusions run early
 * deliberately, to keep the cheapest, most absolute refusal ahead of everything
 * that could be got wrong.
 *
 * Parent/child visibility ceilings are not a gate here. The Asset family clamps a
 * child's scope when it is written, so the proof already evaluates clamped facts;
 * revisit when #386 makes composed child reads their own read path.
 *
 * The function takes facts, not sources: it never reads a role, a UI state, a
 * cache, a link, or a prior result. Supplying stale facts is the caller's bug,
 * which is why the database seam above it reads them fresh on every call.
 */
export function evaluateHouseholdAuthorization(
  request: HouseholdAuthorizationRequest,
): HouseholdAuthorizationProof {
  const { subject, callerUserId, operation } = request;
  if (!callerUserId) {
    return refuse("no_caller");
  }

  if ((subject.lifecycle ?? "active") === "ended") {
    return refuse("record_ended");
  }

  if (subject.excludedUserIds?.includes(callerUserId)) {
    return refuse("domain_exclusion");
  }

  const audience = scopedRecordAudience({
    callerUserId,
    record: {
      ownerUserId: subject.ownerUserId,
      scope: subject.scope,
      householdId: subject.householdId,
      sharedWithUserIds: subject.audienceUserIds,
    },
    activeMemberships: request.callerActiveMemberships,
  });
  if (!audience.visible) {
    return refuse(audience.reason);
  }

  if (
    !canUseSensitiveContext({
      sensitivity: subject.sensitivity ?? "normal",
      directlyRequested: (request.purpose ?? "direct") === "direct",
    })
  ) {
    return refuse("restricted_requires_direct_request");
  }

  const ownership = subject.ownership ?? "member_owned";
  if (MUTATIONS.has(operation) && ownership === "member_owned" && audience.via !== "owner") {
    return refuse("not_record_authority");
  }

  return {
    authorized: true,
    callerUserId,
    operation,
    subjectKind: subject.kind,
    subjectId: subject.id,
    householdId: subject.householdId,
    ownership,
    // A household-native record grants every active member the same standing, so
    // its creator is recorded as household authority too rather than as an owner
    // who might later be read as holding more.
    via: ownership === "household_native" ? "household_authority" : audience.via,
  };
}

/**
 * The single thing a refused caller is ever told.
 *
 * One sentence for "you may not", "it was deleted", "you were removed from that
 * household", and "no such record" alike. It names no record, household, member,
 * or gate, because the difference between those answers is exactly the protected
 * fact (ADR 0219).
 */
export const HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE = "That's no longer available.";

export class HouseholdRecordUnavailableError extends Error {
  override name = "HouseholdRecordUnavailableError";

  constructor() {
    super(HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE);
  }
}

/**
 * The proof-or-nothing form, for the single-record path.
 *
 * The refusal carries no denial reason on purpose: a caller that cannot see the
 * reason cannot leak it, and the reason travels to audit through
 * {@link evaluateHouseholdAuthorization} instead.
 */
export function requireHouseholdAuthorization(
  request: HouseholdAuthorizationRequest,
): HouseholdAuthorizationGrant {
  const proof = evaluateHouseholdAuthorization(request);
  if (!proof.authorized) {
    throw new HouseholdRecordUnavailableError();
  }
  return proof;
}

/**
 * Whether a grant already in hand answers the question being asked now.
 *
 * A proof is about one caller, one operation, and one record; anything holding
 * one — a streamed region, a cache refill, a queued job — has to check that it
 * still matches before acting, and a mismatch means re-prove, never reuse. This
 * does not make a grant fresh: it only stops a valid grant being spent on the
 * wrong question.
 */
export function proofCovers(
  proof: HouseholdAuthorizationGrant,
  request: {
    callerUserId: string;
    operation: HouseholdOperation;
    subjectKind: string;
    subjectId: string;
  },
): boolean {
  return (
    proof.callerUserId === request.callerUserId &&
    proof.operation === request.operation &&
    proof.subjectKind === request.subjectKind &&
    proof.subjectId === request.subjectId
  );
}

/**
 * Proves each member of a bounded composition independently and returns only the
 * ones that hold.
 *
 * Dropping rather than marking is the whole point: a placeholder, a count, or a
 * "hidden item" row would report the existence of a record the caller is not
 * allowed to know about. A visible parent never carries its children through
 * here either — each subject is proved on its own facts.
 */
export function proveHouseholdComposition(input: {
  callerUserId: string;
  operation: HouseholdOperation;
  subjects: readonly HouseholdAuthorizationSubject[];
  callerActiveMemberships: readonly ActiveHouseholdAccess[];
  purpose?: HouseholdRequestPurpose;
}): HouseholdAuthorizationGrant[] {
  const grants: HouseholdAuthorizationGrant[] = [];
  for (const subject of input.subjects) {
    const proof = evaluateHouseholdAuthorization({
      callerUserId: input.callerUserId,
      operation: input.operation,
      subject,
      callerActiveMemberships: input.callerActiveMemberships,
      purpose: input.purpose,
    });
    if (proof.authorized) {
      grants.push(proof);
    }
  }
  return grants;
}

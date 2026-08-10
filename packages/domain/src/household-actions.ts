import { GeneralActionValidationError } from "./general-actions";
import type { HouseholdOperation, HouseholdRecordOwnership } from "./household-authorization";

/**
 * The operations the shared-Action collaboration contract distinguishes.
 *
 * These are the rows of the authority table in
 * `docs/phase-8/shared-household-actions-and-reminders.md`, not the lifecycle
 * transitions: `archive` covers dismissing as well as archiving, and `progress`
 * covers completing and reopening, because those pairs are one authority
 * question each. Permanent deletion is deliberately absent — General Actions have
 * no hard-delete path, and archive is the removal path for a household-native
 * record (ADR 0214).
 */
export type GeneralActionAuthorityOperation =
  | "view"
  | "edit"
  | "people"
  | "progress"
  | "skip"
  | "defer"
  | "archive"
  | "responsibility"
  | "audience";

/**
 * How each operation asks the Household Authorization Proof (ADR 0219).
 *
 * The mapping is the whole point of this module: authority is decided once, by
 * the proof, from the record's ownership form — never by a role check or a scope
 * comparison written beside a mutation. `progress` maps to the proof's own
 * `progress` operation, which is the one mutation the proof grants to a
 * member-owned record's whole audience; every other content-affecting operation
 * maps to `update` or `archive`, which the proof reserves to the owner unless
 * the record belongs to the workspace.
 */
const PROOF_OPERATION: Record<GeneralActionAuthorityOperation, HouseholdOperation> = {
  view: "view",
  edit: "update",
  people: "update",
  progress: "progress",
  // "Not this time" advances the shared occurrence, which is an authoring act on
  // someone else's errand and a symmetric one on the household's chore.
  skip: "update",
  defer: "update",
  archive: "archive",
  responsibility: "update",
  audience: "change_audience",
};

export function householdOperationForGeneralAction(
  operation: GeneralActionAuthorityOperation,
): HouseholdOperation {
  return PROOF_OPERATION[operation];
}

/**
 * The rules the proof cannot express, because they are about the record family
 * rather than about the caller.
 *
 * The proof answers "may *this member* do this to this record". These answer "is
 * this operation a thing this *kind of record* has at all": a member-owned
 * Action has no Responsibility Holder, and a household-native one has neither an
 * audience to change — it is visible to every active member by definition — nor
 * people links, which are one member's own records (ADR 0214). Each fails for
 * every caller including the record's creator, so they run before the proof
 * rather than after: there is nothing to prove.
 *
 * Their messages are curated and safe to show. They name no member and disclose
 * nothing the caller cannot already see, so they do not fall under ADR 0219's
 * single-refusal rule, which governs *whether the caller may know the record
 * exists*.
 */
export function assertGeneralActionOperationForm(input: {
  operation: GeneralActionAuthorityOperation;
  ownership: HouseholdRecordOwnership;
}): void {
  if (input.operation === "responsibility" && input.ownership !== "household_native") {
    throw new GeneralActionValidationError("Only a household action names who's looking after it.");
  }
  if (input.operation === "audience" && input.ownership === "household_native") {
    throw new GeneralActionValidationError(
      "A household action is already there for everyone in the household.",
    );
  }
  if (input.operation === "people" && input.ownership === "household_native") {
    throw new GeneralActionValidationError(
      "People links are personal, so a household action doesn't carry them.",
    );
  }
}

/**
 * Why a workspace-owned record cannot be filed under an Area.
 *
 * An Area is one member's own record, resolved against that member and invisible
 * to everyone else. Filing a household chore under one would either leak that
 * member's private filing to the rest of the household or leave the record
 * somewhere nobody else can reach, edit, or unfile — and a household-native
 * record has no member whose filing it could legitimately be, because its
 * `ownerUserId` is a storage key rather than an owner (ADR 0214). People links
 * are refused for the same reason, by the form check above.
 *
 * So a household chore is simply unfiled. That is a real cost — a household with
 * a "Home maintenance" Area cannot file the water filter under it — and the
 * honest alternative is a household-level Area, which Phase Eight does not have
 * and this issue does not invent.
 */
export function assertHouseholdNativeFilingAllowed(input: {
  ownership: HouseholdRecordOwnership;
  areaId: string | null | undefined;
}): void {
  if (input.ownership === "household_native" && input.areaId) {
    throw new GeneralActionValidationError(
      "Areas are personal, so a household action stays unfiled.",
    );
  }
}

/**
 * A Responsibility Holder is a member's statement about who is looking after a
 * household-native record, so the only thing to validate is that the name is one
 * the household can currently make: an active member, or nobody (ADR 0215).
 *
 * Never inferred and never advanced. There is deliberately no function here that
 * picks a holder, rotates one, or suggests one from history — a rotation would be
 * Tendnote asserting whose turn it is, which is a claim about the past it cannot
 * observe.
 */
export function assertResponsibilityHolder(input: {
  ownership: HouseholdRecordOwnership;
  holderUserId: string | null;
  activeMemberUserIds: readonly string[];
}): string | null {
  assertGeneralActionOperationForm({ operation: "responsibility", ownership: input.ownership });
  if (input.holderUserId === null) {
    return null;
  }
  if (!input.activeMemberUserIds.includes(input.holderUserId)) {
    throw new GeneralActionValidationError(
      "Choose someone who's currently in this household, or leave it unnamed.",
    );
  }
  return input.holderUserId;
}

/**
 * How a surface says who is looking after a record.
 *
 * Quiet and factual, and never a claim about whose turn it is or whether they
 * did it. An unnamed record returns `null` rather than a placeholder: no holder
 * is the ordinary case, and "nobody has taken this on" would read as a reproach
 * for the calmest, most common state a household chore can be in.
 */
export function responsibilityHolderLabel(input: {
  holderName: string | null;
  isSelf: boolean;
}): string | null {
  if (input.isSelf) return "You're looking after this";
  return input.holderName ? `${input.holderName} is looking after this` : null;
}

/** The unnamed option in a holder picker. Stated as a choice, never as a gap. */
export const NO_RESPONSIBILITY_HOLDER_LABEL = "No one in particular";

/** The hand-off offered in place when an occurrence is completed or skipped. */
export const RESPONSIBILITY_HANDOFF_PROMPT = "Who's looking after this next?";

/**
 * What a member who acted against an occurrence someone else had already handled
 * is told.
 *
 * Progress is reconciled rather than refused: the member's tap was a truthful
 * report, it simply arrived second, and the product's job is to settle on the
 * authoritative outcome and say plainly what happened to it. Never a failure,
 * never a conflict, and never a suggestion that the member did something wrong.
 */
export type GeneralActionProgressReconciliation = {
  handledAs: "completed" | "skipped";
  handledByName: string | null;
  handledAt: Date;
};

export function describeProgressReconciliation(
  reconciliation: GeneralActionProgressReconciliation,
  formatDate: (date: Date) => string,
): string {
  const when = formatDate(reconciliation.handledAt);
  // Written out per case rather than assembled from a noun, because the natural
  // sentence differs: you mark something done, but you skip it. A skip is also
  // never softened into a completion — "not this time" is its own outcome.
  if (reconciliation.handledAs === "skipped") {
    return reconciliation.handledByName
      ? `${reconciliation.handledByName} already skipped this one ${when}.`
      : `This one was already skipped ${when}.`;
  }
  return reconciliation.handledByName
    ? `${reconciliation.handledByName} already marked this done ${when}.`
    : `This was already done ${when}.`;
}

/**
 * Whether a household-visible record belongs on one member's private Today.
 *
 * Household visibility alone is not personal relevance (Phase Eight narrows
 * Phase Seven here): without a positive signal tying the record to this member,
 * every chore would land in both partners' shortlists and Today would stop
 * answering what is relevant to *me*. A household-native Routine with no holder
 * and no subscriber is the intended calm case — it sits on the shared Household
 * home and nags nobody.
 *
 * A household-native record has no member owner, so the ownership signal only
 * ever fires for a member-owned one; its `ownerUserId` is a storage key, not a
 * claim on anyone's attention.
 */
export function isPersonallyRelevantHouseholdRecord(input: {
  memberUserId: string;
  ownership: HouseholdRecordOwnership;
  ownerUserId: string;
  scope: "private" | "shared" | "household";
  responsibilityHolderUserId: string | null;
  hasOwnReminderSchedule: boolean;
}): boolean {
  if (input.scope === "private") return true;
  if (input.ownership === "member_owned" && input.ownerUserId === input.memberUserId) return true;
  if (input.responsibilityHolderUserId === input.memberUserId) return true;
  return input.hasOwnReminderSchedule;
}

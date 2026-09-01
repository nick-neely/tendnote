/**
 * What the owner is being asked about, for every Eve tool call that parks.
 *
 * ## Why this exists at all
 *
 * eve 0.47.7 builds a parked call's approval request itself: a fixed prompt
 * (`Approve tool call: archive_memory`) and the frozen tool input. For the
 * durable writes Eve makes, that input is usually a uuid and nothing else, so
 * the person being asked to authorise a permanent change is shown a name and a
 * number. This turns the id back into the record — its title, its current
 * wording, the change about to be applied — so the approval is a decision rather
 * than a reflex.
 *
 * ## The two rules that make it safe
 *
 * Every load goes through an existing owner-scoped `@tendnote/db` query entry
 * point, never a raw read by id, so a describer cannot see further than the
 * mutation it describes will reach. And a record that does not resolve is
 * `missing` — the same answer as "no such record" and "that input did not
 * parse" — which the caller turns into the single opaque denial (ADR 0219). A
 * foreign id therefore never reaches an approval card, and the card is never an
 * oracle for whether somebody else's record exists.
 *
 * A tool with no describer answers `unknown-tool`, which is not a refusal: the
 * caller falls back to rendering the raw input. Text-carrying writes
 * (`create_person`, `remember_self_context`) are legible from their input alone
 * and are deliberately not registered.
 */

import { assetApprovalSubjects } from "./approval-subjects/assets";
import { captureApprovalSubjects } from "./approval-subjects/captures";
import type { ApprovalSubjectDescribers } from "./approval-subjects/define";
import { draftApprovalSubjects } from "./approval-subjects/drafts";
import { followupApprovalSubjects } from "./approval-subjects/followups";
import { generalActionApprovalSubjects } from "./approval-subjects/general-actions";
import { giftPlanApprovalSubjects } from "./approval-subjects/gift-plans";
import { memoryApprovalSubjects } from "./approval-subjects/memories";
import { peopleApprovalSubjects } from "./approval-subjects/people";
import { selfContextApprovalSubjects } from "./approval-subjects/self-context";
import type { ApprovalSubject, ApprovalSubjectLookup } from "./approval-subjects/types";

export {
  APPROVAL_SUBJECT_LINE_MAX_LENGTH,
  APPROVAL_SUBJECT_TITLE_MAX_LENGTH,
} from "./approval-subjects/define";
export type { ApprovalSubject, ApprovalSubjectLookup };

const DESCRIBERS: ApprovalSubjectDescribers = {
  ...assetApprovalSubjects,
  ...captureApprovalSubjects,
  ...draftApprovalSubjects,
  ...followupApprovalSubjects,
  ...generalActionApprovalSubjects,
  ...giftPlanApprovalSubjects,
  ...memoryApprovalSubjects,
  ...peopleApprovalSubjects,
  ...selfContextApprovalSubjects,
};

/** The tools a describer is registered for, sorted. */
export const APPROVAL_SUBJECT_TOOL_NAMES: readonly string[] = Object.freeze(
  Object.keys(DESCRIBERS).sort(),
);

/**
 * Describes what one parked tool call is about, inside `ownerUserId`'s scope.
 *
 * Never throws: a store outage, a describer bug, or input of an unexpected shape
 * all answer `missing`, which fails closed at the caller.
 */
export async function describeApprovalSubject(params: {
  ownerUserId: string;
  toolName: string;
  /** The frozen tool input. Untrusted shape — every describer validates it. */
  input: unknown;
}): Promise<ApprovalSubjectLookup> {
  const describer = Object.hasOwn(DESCRIBERS, params.toolName)
    ? DESCRIBERS[params.toolName]
    : undefined;
  if (describer === undefined) return { kind: "unknown-tool" };
  if (!params.ownerUserId.trim()) return { kind: "missing" };

  try {
    return await describer(params.input, params.ownerUserId);
  } catch {
    return { kind: "missing" };
  }
}

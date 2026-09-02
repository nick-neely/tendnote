import {
  type ConversationalCaptureChangeTarget,
  type ConversationalCaptureUndoTarget,
  conversationalCaptureChangeTargetSchema,
  conversationalCaptureUndoTargetSchema,
} from "@tendnote/domain/conversational-capture";
import { z } from "zod";
import { getAssetReviewGroup } from "../assets";
import { getSelfContextFact } from "../context-facts";
import { getFollowup } from "../followups";
import { getGeneralAction } from "../general-actions";
import { getMemory } from "../memories";
import { getPerson } from "../people";
import { getSavedItem } from "../saved-items";
import { type ApprovalSubjectDescribers, defineSubject, detail, ownedBy, subject } from "./define";

/** One resolved Change or Undo target: what it is, and which one. */
type ResolvedCaptureTarget = { what: string; detail?: string };

type CaptureTarget = ConversationalCaptureChangeTarget | ConversationalCaptureUndoTarget;

/**
 * One resolver per target kind, each narrowed to the target that names it.
 *
 * The tools take a target the model hands back verbatim, and until this existed
 * nothing between the schema and the mutation asked whether the record it names
 * is the caller's. Every branch answers that through the read seam whose
 * visibility is already the boundary its mutation applies - except Follow-Ups,
 * which are visible to a household member and owner-only to mutate, so that
 * branch narrows to the owner with {@link ownedBy}. A target that resolves to
 * nothing is `missing`, which the caller turns into the one opaque denial.
 */
type CaptureTargetResolvers = {
  [Kind in CaptureTarget["kind"]]: (
    target: Extract<CaptureTarget, { kind: Kind }>,
    ownerUserId: string,
  ) => Promise<ResolvedCaptureTarget | null>;
};

// Not narrowed to the owner: a household-native Saved Item carries no
// `ownerUserId` at all, and the read seam has already proved the caller may see
// this one.
async function resolveSavedItem(savedItemId: string, ownerUserId: string) {
  const savedItem = await getSavedItem({ callerUserId: ownerUserId, savedItemId });
  return savedItem ? { what: "saved item", detail: savedItem.title } : null;
}

async function resolveGeneralAction(generalActionId: string, ownerUserId: string) {
  const action = await getGeneralAction({ actorUserId: ownerUserId, generalActionId });
  return action ? { what: "action", detail: action.title } : null;
}

/**
 * The composition the finding named: a shared Follow-Up is visible to a
 * household member and read-only to them, so a forged `archive_followup` target
 * could name a member's reminder and reach a lifecycle call.
 */
async function resolveFollowup(followupId: string, ownerUserId: string) {
  const followup = ownedBy(
    await getFollowup({ actorUserId: ownerUserId, followupId }),
    ownerUserId,
  );
  return followup ? { what: "follow-up", detail: followup.reason } : null;
}

async function resolveMemory(memoryId: string, ownerUserId: string) {
  const memory = await getMemory({ ownerUserId, memoryId });
  return memory ? { what: "memory", detail: memory.content } : null;
}

async function resolvePerson(personId: string, ownerUserId: string) {
  const person = await getPerson({ ownerUserId, personId });
  return person ? { what: "person", detail: person.displayName } : null;
}

// No detail line: a review group is a container, and naming the facts inside it
// is the review surface's job rather than this one's.
async function resolveAssetReview(groupId: string, ownerUserId: string) {
  const group = await getAssetReviewGroup({ actorUserId: ownerUserId, groupId });
  return group ? { what: "asset review" } : null;
}

async function resolveContextFact(contextFactId: string, ownerUserId: string) {
  const fact = await getSelfContextFact(
    {
      callerUserId: ownerUserId,
      contextFactId,
      includeRestricted: true,
      includeArchived: true,
    },
    async () => ownerUserId,
  );
  return fact ? { what: "fact about you", detail: fact.content } : null;
}

const CAPTURE_TARGET_RESOLVERS: CaptureTargetResolvers = {
  archive_saved_item: (target, owner) => resolveSavedItem(target.savedItemId, owner),
  edit_saved_item: (target, owner) => resolveSavedItem(target.savedItemId, owner),
  archive_general_action: (target, owner) => resolveGeneralAction(target.generalActionId, owner),
  edit_general_action: (target, owner) => resolveGeneralAction(target.generalActionId, owner),
  archive_followup: (target, owner) => resolveFollowup(target.followupId, owner),
  edit_followup: (target, owner) => resolveFollowup(target.followupId, owner),
  archive_memory: (target, owner) => resolveMemory(target.memoryId, owner),
  edit_memory: (target, owner) => resolveMemory(target.memoryId, owner),
  edit_person: (target, owner) => resolvePerson(target.personId, owner),
  dismiss_asset_review: (target, owner) => resolveAssetReview(target.groupId, owner),
  edit_asset_review: (target, owner) => resolveAssetReview(target.groupId, owner),
  archive_context_fact: (target, owner) => resolveContextFact(target.contextFactId, owner),
  edit_context_fact: (target, owner) => resolveContextFact(target.contextFactId, owner),
};

/**
 * What a Change or Undo target actually points at, resolved in the caller's own
 * scope.
 *
 * The discriminator has already been validated by the tool's schema, so an
 * unregistered kind cannot arrive here through a describer; the lookup is still
 * written as one that can miss, because the map and the schemas are two lists
 * and only one of them fails loudly when they disagree.
 */
function resolveTarget(
  target: CaptureTarget,
  ownerUserId: string,
): Promise<ResolvedCaptureTarget | null> {
  const resolve = Object.hasOwn(CAPTURE_TARGET_RESOLVERS, target.kind)
    ? (CAPTURE_TARGET_RESOLVERS[target.kind] as (
        target: CaptureTarget,
        ownerUserId: string,
      ) => Promise<ResolvedCaptureTarget | null>)
    : undefined;

  return resolve === undefined ? Promise.resolve(null) : resolve(target, ownerUserId);
}

export const captureApprovalSubjects: ApprovalSubjectDescribers = {
  capture_source_record: defineSubject({
    schema: z.object({
      retainedContent: z.string().min(1),
      personId: z.uuid().optional(),
      sensitivity: z.string().optional(),
    }),
    // A note with no person is still the owner's to authorise; a note naming
    // somebody else's person id is not, so the lookup stands in for the record.
    load: async (input, ownerUserId) =>
      input.personId === undefined
        ? { displayName: null }
        : await getPerson({ ownerUserId, personId: input.personId }),
    describe: (person, input) =>
      subject(person.displayName ? `Log a note about ${person.displayName}` : "Log a note", [
        detail("Note", input.retainedContent),
        detail("Sensitivity", input.sensitivity),
        "It is logged context, not a confirmed fact.",
      ]),
  }),

  change_saved_item_capture: defineSubject({
    schema: z.object({
      target: conversationalCaptureChangeTargetSchema,
      originalText: z.string().min(1),
      clarificationAnswer: z.string().optional(),
    }),
    load: (input, ownerUserId) => resolveTarget(input.target, ownerUserId),
    describe: (found, input) =>
      subject(`Correct the ${found.what} you just captured`, [
        detail("Currently", found.detail),
        detail("From", input.originalText),
        detail("Correction", input.clarificationAnswer),
      ]),
  }),

  undo_saved_item_capture: defineSubject({
    schema: z.object({ target: conversationalCaptureUndoTargetSchema }),
    load: (input, ownerUserId) => resolveTarget(input.target, ownerUserId),
    describe: (found) =>
      subject(`Undo the ${found.what} you just captured`, [
        detail("Undoing", found.detail),
        "The note it came from is kept.",
      ]),
  }),
};

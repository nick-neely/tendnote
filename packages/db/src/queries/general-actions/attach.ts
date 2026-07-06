import {
  assertAreaNotArchived,
  type GeneralActionEdit,
  GeneralActionValidationError,
  type PrivacyScope,
} from "@tendnote/domain";
import type { GeneralActionLifecycleStore, GeneralActionPatch } from "./types";

/**
 * The owner-scoped verifications a General Action's attachments go through before they
 * are persisted — Area assignment, visibility scope, share materialization, and people
 * links. Extracted from the lifecycle factory so the direct-creation path and the
 * review/promotion path apply exactly the same rules (ADRs 0146, 0153, 0155). Each is a
 * plain function over a store subset, not a closure, so both callers share one source
 * of truth for these guards.
 */
export type GeneralActionAttachStore = Pick<
  GeneralActionLifecycleStore,
  | "getArea"
  | "getPerson"
  | "getHouseholdMembership"
  | "listHouseholdMemberships"
  | "createHouseholdRecordShare"
>;

/**
 * Resolves an Area assignment, keeping the one-primary-Area rule owner-safe. A non-null
 * `areaId` must name an Area the owner owns and has not archived — you cannot file an
 * Action under someone else's Area or a retired one. `null` clears the Area.
 */
export async function resolveAreaId(
  store: GeneralActionAttachStore,
  ownerUserId: string,
  areaId: string | null,
): Promise<string | null> {
  if (areaId === null) {
    return null;
  }

  const area = await store.getArea({ ownerUserId, areaId });
  if (!area) {
    throw new GeneralActionValidationError("That area no longer exists.");
  }
  assertAreaNotArchived(area);

  return area.id;
}

/**
 * Validates and normalizes a visibility choice, fail-closed. Private clears the
 * household; a household or shared scope requires the owner's active household, and a
 * shared scope additionally requires at least one selected active member. Widening is
 * always explicit — an absent scope stays private (ADR 0153).
 */
export async function resolveVisibility(
  store: GeneralActionAttachStore,
  input: {
    ownerUserId: string;
    scope?: PrivacyScope;
    householdId?: string | null;
    selectedUserIds?: string[];
  },
): Promise<{ scope: PrivacyScope; householdId: string | null }> {
  const scope = input.scope ?? "private";

  if (scope === "private") {
    return { scope, householdId: null };
  }

  // Non-private from here: `householdId` is a concrete string in every branch below.
  const householdId = input.householdId ?? null;
  if (!householdId) {
    throw new GeneralActionValidationError("Sharing an action needs a household.");
  }
  const membership = await store.getHouseholdMembership({
    householdId,
    userId: input.ownerUserId,
  });
  if (membership?.status !== "active") {
    throw new GeneralActionValidationError(
      "You must be an active member of that household to share an action.",
    );
  }

  if (scope === "shared") {
    const selected = input.selectedUserIds ?? [];
    if (selected.length === 0) {
      throw new GeneralActionValidationError(
        "Choose at least one person to share this action with.",
      );
    }
    const activeMembers = await store.listHouseholdMemberships({
      householdId,
      status: "active",
    });
    const activeIds = new Set(activeMembers.map((member) => member.userId));
    if (selected.some((userId) => !activeIds.has(userId))) {
      throw new GeneralActionValidationError(
        "Everyone you share an action with must be an active household member.",
      );
    }
  }

  return { scope, householdId };
}

/** Records a share row per selected member so a shared Action reaches exactly them. */
export async function writeShares(
  store: GeneralActionAttachStore,
  input: {
    householdId: string;
    actionId: string;
    ownerUserId: string;
    selectedUserIds: string[];
  },
): Promise<void> {
  for (const sharedWithUserId of input.selectedUserIds) {
    await store.createHouseholdRecordShare({
      householdId: input.householdId,
      recordKind: "general_action",
      recordId: input.actionId,
      sharedWithUserId,
      sharedByUserId: input.ownerUserId,
    });
  }
}

/**
 * Verifies every person link is one the owner owns and returns the deduped set. A link
 * is context only — it never turns the Action into a Follow-Up (ADR 0155) — but it must
 * still be owner-scoped so an Action cannot point at a stranger's person record.
 */
export async function verifyOwnedPeople(
  store: GeneralActionAttachStore,
  ownerUserId: string,
  personIds: string[],
): Promise<string[]> {
  const unique = [...new Set(personIds)];
  for (const personId of unique) {
    const person = await store.getPerson({ ownerUserId, personId });
    if (!person) {
      throw new GeneralActionValidationError("You can only link your own people to an action.");
    }
  }
  return unique;
}

/**
 * Maps a validated content edit to the bounded patch fields it touches, resolving an
 * Area assignment owner-safely. Only keys the edit actually carries are set — an absent
 * key is never written, so a partial edit never wipes untouched columns. Shared by the
 * direct-edit path and the review edit/accept paths so a General Action's content edit
 * behaves identically wherever it happens; callers add their own status/actor fields and
 * any lifecycle guards (e.g. the paused-Routine cadence rule) around it.
 */
export async function buildGeneralActionEditPatch(
  store: GeneralActionAttachStore,
  ownerUserId: string,
  edit: GeneralActionEdit,
): Promise<GeneralActionPatch> {
  const patch: GeneralActionPatch = {};
  if (edit.title !== undefined) {
    patch.title = edit.title;
  }
  if (edit.notes !== undefined) {
    patch.notes = edit.notes;
  }
  if (edit.dueAt !== undefined) {
    patch.dueAt = edit.dueAt;
  }
  if (edit.links !== undefined) {
    patch.links = edit.links;
  }
  if (edit.assetHints !== undefined) {
    patch.assetHints = edit.assetHints;
  }
  if (edit.recurrence !== undefined) {
    patch.recurrence = edit.recurrence;
  }
  if (edit.areaId !== undefined) {
    patch.areaId = await resolveAreaId(store, ownerUserId, edit.areaId);
  }
  return patch;
}

/** Whether a validated content edit carries no changes at all, so a no-op can be rejected. */
export function isEmptyGeneralActionEdit(edit: GeneralActionEdit): boolean {
  return (
    edit.title === undefined &&
    edit.notes === undefined &&
    edit.dueAt === undefined &&
    edit.links === undefined &&
    edit.areaId === undefined &&
    edit.assetHints === undefined &&
    edit.recurrence === undefined
  );
}

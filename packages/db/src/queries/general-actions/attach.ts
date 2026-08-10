import {
  assertAreaNotArchived,
  type CreateGeneralActionInput,
  type GeneralActionAssetHint,
  type GeneralActionEdit,
  type GeneralActionOwnership,
  GeneralActionValidationError,
  type PrivacyScope,
} from "@tendnote/domain";
import { resolveRecordVisibility } from "../households/record-visibility";
import type {
  CreateActiveGeneralActionInput,
  GeneralActionLifecycleStore,
  GeneralActionPatch,
  SuggestGeneralActionInput,
} from "./types";

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
  return resolveRecordVisibility(store, input, {
    recordNoun: "action",
    recordNounWithArticle: "an action",
    fail: (message) => new GeneralActionValidationError(message),
  });
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
 * Finalizes an accept's visibility onto the promotion `patch`, only when the accept
 * explicitly chose a scope (otherwise the proposal's scope is kept). Re-runs the shared
 * visibility guard so a reviewer can widen a proposal to a selected-shared audience the
 * bare proposal could not hold; returns the shares to write when the accepted scope is a
 * selected-shared one, or `null` otherwise. Mutates `patch` in place with the resolved scope.
 */
export async function resolveAcceptScope(
  store: GeneralActionAttachStore,
  input: {
    ownerUserId: string;
    scope?: PrivacyScope;
    householdId?: string | null;
    selectedUserIds?: string[];
  },
  patch: GeneralActionPatch,
): Promise<{ householdId: string; selectedUserIds: string[] } | null> {
  if (input.scope === undefined) {
    return null;
  }

  const { scope, householdId } = await resolveVisibility(store, {
    ownerUserId: input.ownerUserId,
    scope: input.scope,
    householdId: input.householdId,
    selectedUserIds: input.selectedUserIds,
  });
  patch.scope = scope;
  patch.householdId = householdId;

  if (scope === "shared" && householdId) {
    return { householdId, selectedUserIds: input.selectedUserIds ?? [] };
  }

  return null;
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

/**
 * Resolves optional source grounding, owner-scoped. A present `sourceRecordId` must name a
 * record the owner can see; absent grounding is `null`. Extracted so the create path stays
 * a flat orchestration.
 */
export async function resolveSourceRecordId(
  store: Pick<GeneralActionLifecycleStore, "getSourceRecord">,
  ownerUserId: string,
  sourceRecordId: string | null | undefined,
): Promise<string | null> {
  if (!sourceRecordId) {
    return null;
  }

  const sourceRecord = await store.getSourceRecord({ ownerUserId, sourceRecordId });
  if (!sourceRecord) {
    throw new Error("Source record not found.");
  }

  return sourceRecord.id;
}

/**
 * Builds the persisted create-values for a new active General Action from the caller input
 * and the already-resolved attachments, applying the field defaults (private-open, no defer,
 * creator provenance). Kept a pure function so the lifecycle create path reads as resolve →
 * build → persist → finalize without inlining a dozen `?? null` defaults.
 */
export function buildCreateGeneralActionValues(
  input: CreateActiveGeneralActionInput | SuggestGeneralActionInput,
  resolved: {
    status: "open" | "suggested";
    sourceRecordId: string | null;
    areaId: string | null;
    scope: PrivacyScope;
    householdId: string | null;
    ownership?: GeneralActionOwnership;
    responsibilityHolderUserId?: string | null;
  },
): CreateGeneralActionInput {
  const assetHints: GeneralActionAssetHint[] = input.assetHints ?? [];
  const deferUntil = "deferUntil" in input ? (input.deferUntil ?? null) : null;

  return {
    ...("id" in input && input.id ? { id: input.id } : {}),
    ownerUserId: input.ownerUserId,
    title: input.title,
    notes: input.notes ?? null,
    links: input.links ?? [],
    assetHints,
    status: resolved.status,
    dueAt: input.dueAt ?? null,
    deferUntil,
    recurrence: input.recurrence ?? null,
    sourceRecordId: resolved.sourceRecordId,
    areaId: resolved.areaId,
    scope: resolved.scope,
    householdId: resolved.householdId,
    ownership: resolved.ownership ?? "member_owned",
    responsibilityHolderUserId: resolved.responsibilityHolderUserId ?? null,
    occurrenceVersion: 0,
    // Creator provenance survives everything. On a household-native record it is
    // the only thing its creator keeps, and it stays readable after they leave —
    // every surface that attributes authorship reads this rather than ownership,
    // because a workspace-owned record has no member owner to attribute to
    // (ADRs 0154, 0214).
    createdByUserId: input.ownerUserId,
    lastActorUserId: input.ownerUserId,
    completedAt: null,
  };
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

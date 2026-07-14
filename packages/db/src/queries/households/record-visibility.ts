import type { PrivacyScope } from "@tendnote/domain";
import type { HouseholdStore } from "./types";

/** The two membership reads the shared visibility guard performs. */
type RecordVisibilityStore = Pick<
  HouseholdStore,
  "getHouseholdMembership" | "listHouseholdMemberships"
>;

/**
 * How a record family plugs its wording and error type into the shared guard:
 * `recordNoun` names the record for "this X" phrasing ("action", "asset"),
 * `recordNounWithArticle` carries its own indefinite article for "share X"
 * phrasing ("an action", "a followup"), and `fail` wraps the messages in the
 * family's user-safe validation error so surfaces can render them inline.
 */
export type RecordVisibilityOptions = {
  recordNoun: string;
  recordNounWithArticle: string;
  fail: (message: string) => Error;
};

/** Requires the owner to be an active member of the household they are sharing into. */
async function requireActiveOwnerMembership(
  store: RecordVisibilityStore,
  input: { householdId: string; ownerUserId: string },
  options: RecordVisibilityOptions,
): Promise<void> {
  const membership = await store.getHouseholdMembership({
    householdId: input.householdId,
    userId: input.ownerUserId,
  });
  if (membership?.status !== "active") {
    throw options.fail(
      `You must be an active member of that household to share ${options.recordNounWithArticle}.`,
    );
  }
}

/** Requires a non-empty selected audience of active members for a `shared` scope. */
async function requireSelectedActiveMembers(
  store: RecordVisibilityStore,
  input: { householdId: string; selectedUserIds: string[] },
  options: RecordVisibilityOptions,
): Promise<void> {
  if (input.selectedUserIds.length === 0) {
    throw options.fail(`Choose at least one person to share this ${options.recordNoun} with.`);
  }
  const activeMembers = await store.listHouseholdMemberships({
    householdId: input.householdId,
    status: "active",
  });
  const activeIds = new Set(activeMembers.map((member) => member.userId));
  if (input.selectedUserIds.some((userId) => !activeIds.has(userId))) {
    throw options.fail(
      `Everyone you share ${options.recordNounWithArticle} with must be an active household member.`,
    );
  }
}

/**
 * Validates and normalizes a scoped record's visibility choice, fail-closed:
 * private clears the household; a household or shared scope requires the owner's
 * active household, and a shared scope additionally requires at least one selected
 * active member. Widening is always explicit — an absent scope stays private
 * (ADR 0153). The single guard General Actions and Assets share, so the scope
 * rules never fork between record families.
 */
export async function resolveRecordVisibility(
  store: RecordVisibilityStore,
  input: {
    ownerUserId: string;
    scope?: PrivacyScope;
    householdId?: string | null;
    selectedUserIds?: string[];
  },
  options: RecordVisibilityOptions,
): Promise<{ scope: PrivacyScope; householdId: string | null }> {
  const scope = input.scope ?? "private";
  if (scope === "private") {
    return { scope, householdId: null };
  }

  // Non-private from here: `householdId` is a concrete string in every branch below.
  const householdId = input.householdId ?? null;
  if (!householdId) {
    throw options.fail(`Sharing ${options.recordNounWithArticle} needs a household.`);
  }
  await requireActiveOwnerMembership(
    store,
    { householdId, ownerUserId: input.ownerUserId },
    options,
  );

  if (scope === "shared") {
    await requireSelectedActiveMembers(
      store,
      { householdId, selectedUserIds: input.selectedUserIds ?? [] },
      options,
    );
  }

  return { scope, householdId };
}

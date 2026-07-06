import type { GeneralAction } from "@tendnote/domain";
import type { GeneralActionLifecycleStore, GeneralActionWithContext } from "./types";

/**
 * The store surface hydration needs: the people-link join, owner-scoped person
 * resolution, and the household workspace/shares lookups behind a scope. A subset
 * of {@link GeneralActionLifecycleStore} so both the active lifecycle and the
 * review lifecycle can share one hydration path instead of drifting.
 */
export type GeneralActionHydrationStore = Pick<
  GeneralActionLifecycleStore,
  "listGeneralActionPersonIds" | "getPerson" | "getHouseholdWorkspace" | "listHouseholdRecordShares"
>;

/**
 * Hydrates a persisted action with its linked people (resolved owner-scoped and
 * named for display) and the audience detail behind its scope — how many members a
 * `shared` action reaches, and the household's name for a `shared`/`household` one —
 * so a surface can say *who* can see it, not just that it is shared. A viewing member
 * sees the names the owner chose to attach, never raw ids or other owner-scoped
 * fields (ADRs 0153, 0155). Shared by the direct-creation lifecycle and the
 * review/promotion lifecycle so both present an action identically.
 */
export async function hydrateGeneralAction(
  store: GeneralActionHydrationStore,
  action: GeneralAction,
): Promise<GeneralActionWithContext> {
  const personIds = await store.listGeneralActionPersonIds({
    ownerUserId: action.ownerUserId,
    generalActionId: action.id,
  });
  const linkedPeople: GeneralActionWithContext["linkedPeople"] = [];
  for (const personId of personIds) {
    const person = await store.getPerson({ ownerUserId: action.ownerUserId, personId });
    if (person) {
      linkedPeople.push({ id: person.id, displayName: person.displayName });
    }
  }

  let sharedWithCount = 0;
  let householdName: string | null = null;
  if (action.scope !== "private" && action.householdId) {
    const household = await store.getHouseholdWorkspace({ householdId: action.householdId });
    householdName = household?.name ?? null;
    if (action.scope === "shared") {
      const shares = await store.listHouseholdRecordShares({
        householdId: action.householdId,
        recordKind: "general_action",
        recordId: action.id,
      });
      sharedWithCount = shares.length;
    }
  }

  return { ...action, linkedPeople, sharedWithCount, householdName };
}

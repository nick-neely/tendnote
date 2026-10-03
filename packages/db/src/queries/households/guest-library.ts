import {
  ASSET_KIND_OPTIONS,
  type Asset,
  type ContextFactView,
  contextFactCategoryLabel,
  type GeneralAction,
  type GiftPlan,
  type HouseholdRole,
  type SharedRelationshipRecordView,
} from "@tendnote/domain";
import {
  GUEST_LIBRARY_DOMAINS,
  type GuestLibrary,
  type GuestLibraryCandidate,
  type GuestLibraryDomain,
  type GuestLibraryShelf,
  toGuestLibraryRecords,
} from "@tendnote/domain/guest-library";

type GuestHousehold = {
  name: string;
  members: ReadonlyArray<{ userId: string; name: string; role: HouseholdRole }>;
};

/**
 * The reads the guest library composes. Each is a domain's own authorized,
 * caller-keyed read: none takes a household id, and each proves its records for
 * the caller before returning them. The library adds the guest gate on top, so
 * a read that also serves members (and returns their private records to them)
 * can never widen what a guest sees.
 */
export type GuestLibraryReads = {
  readHousehold: (input: { userId: string }) => Promise<GuestHousehold | null>;
  listSharedRelationshipRecords: (input: {
    callerUserId: string;
    recordKind: "memory" | "followup";
  }) => Promise<SharedRelationshipRecordView[]>;
  listActiveGeneralActions: (input: { ownerUserId: string }) => Promise<GeneralAction[]>;
  listAssets: (input: {
    callerUserId: string;
    scopes: ["household", "shared"];
    statuses: ["active"];
  }) => Promise<Asset[]>;
  listGiftPlans: (input: { callerUserId: string }) => Promise<GiftPlan[]>;
  listHouseholdContextFacts: (input: { callerUserId: string }) => Promise<ContextFactView[]>;
  /**
   * Household Calendar Events, already shaped. A read-through of the provider,
   * so the web app supplies it with the credential plumbing it owns.
   */
  listCalendarEvents: (input: { callerUserId: string }) => Promise<GuestLibraryCandidate[]>;
};

const ROLE_LABEL: Record<HouseholdRole, string> = {
  owner: "Household Owner",
  member: "Household Member",
};

const ASSET_KIND_LABEL = new Map(ASSET_KIND_OPTIONS.map((option) => [option.kind, option.label]));

/** A member-owned record whose owner has since left still has an owner; it is not the household's. */
const FORMER_MEMBER = "A former member";

/**
 * The Household Guest's read-only library (#636): every readable record in the
 * guest's household, one shelf per read-set domain.
 *
 * Read on every request and never cached, because the guest's standing can end
 * between two requests (ADR 0245). A record reaches a shelf only when its own
 * domain's read proves it for the guest **and** the guest gate keeps it
 * (household-native, household-scope, or shared-scope and not the guest's own),
 * and a shelf's count is its list's length, so a withheld record is neither
 * rendered nor counted. A domain whose read fails says so rather than claiming
 * to be empty, and never hides the others.
 */
export function createGuestLibraryReader(reads: GuestLibraryReads) {
  return async function getGuestLibrary(input: {
    guestUserId: string;
  }): Promise<GuestLibrary | null> {
    const callerUserId = input.guestUserId;
    const household = await reads.readHousehold({ userId: callerUserId });
    if (!household) return null;

    const names = new Map(household.members.map((member) => [member.userId, member.name]));
    const nameOf = (userId: string) => names.get(userId) ?? FORMER_MEMBER;
    const memberOwned = (ownerUserId: string) => ({
      householdNative: false,
      viewerIsOwner: ownerUserId === callerUserId,
      belongsTo: nameOf(ownerUserId),
    });

    const loaders: Record<GuestLibraryDomain, () => Promise<GuestLibraryCandidate[]>> = {
      people: async () =>
        household.members
          .filter((member) => member.userId !== callerUserId)
          .map((member) => ({
            id: member.userId,
            title: member.name,
            context: ROLE_LABEL[member.role],
            body: null,
            belongsTo: null,
            date: null,
            scope: "household",
            householdNative: true,
            viewerIsOwner: false,
          })),
      memories: async () =>
        (await reads.listSharedRelationshipRecords({ callerUserId, recordKind: "memory" })).map(
          (view) => sharedCandidate(view, view.recordedAt),
        ),
      followUps: async () =>
        (await reads.listSharedRelationshipRecords({ callerUserId, recordKind: "followup" })).map(
          (view) => sharedCandidate(view, view.dueAt),
        ),
      generalActions: async () =>
        (await reads.listActiveGeneralActions({ ownerUserId: callerUserId })).map((action) => {
          const holder = action.responsibilityHolderUserId;
          return {
            id: action.id,
            title: action.title,
            context: holder ? `Looked after by ${nameOf(holder)}` : null,
            body: action.notes,
            date: action.dueAt,
            scope: action.scope,
            ...(action.ownership === "household_native"
              ? householdOwned()
              : memberOwned(action.ownerUserId)),
          };
        }),
      assets: async () =>
        (
          await reads.listAssets({
            callerUserId,
            scopes: ["household", "shared"],
            statuses: ["active"],
          })
        ).map((asset) => ({
          id: asset.id,
          title: asset.name,
          context: ASSET_KIND_LABEL.get(asset.kind) ?? null,
          body: null,
          date: asset.createdAt,
          scope: asset.scope,
          ...(asset.ownership === "household_native"
            ? householdOwned()
            : memberOwned(asset.ownerUserId)),
        })),
      giftPlans: async () =>
        (await reads.listGiftPlans({ callerUserId })).map((plan) => ({
          id: plan.id,
          title: plan.occasion,
          context: `For ${plan.subjectName}`,
          body: null,
          date: plan.occasionOn,
          scope: plan.scope,
          ...memberOwned(plan.ownerUserId),
        })),
      householdContext: async () =>
        (await reads.listHouseholdContextFacts({ callerUserId })).map((fact) => ({
          id: fact.id,
          title: fact.content,
          context: contextFactCategoryLabel(fact.category),
          body: null,
          date: fact.reviewedAt ?? fact.createdAt,
          scope: "household",
          ...householdOwned(),
        })),
      calendarEvents: () => reads.listCalendarEvents({ callerUserId }),
    };

    const shelves = await Promise.all(
      GUEST_LIBRARY_DOMAINS.map(async (domain): Promise<GuestLibraryShelf> => {
        try {
          return {
            domain,
            records: toGuestLibraryRecords(await loaders[domain]()),
            unavailable: false,
          };
        } catch {
          return { domain, records: [], unavailable: true };
        }
      }),
    );
    return { householdName: household.name, shelves };
  };
}

function householdOwned() {
  return { householdNative: true, viewerIsOwner: false, belongsTo: null };
}

/**
 * A memory or follow-up through the share envelope, which by construction
 * carries only what its owner exposed: never their Person, evidence, or ids.
 */
function sharedCandidate(
  view: SharedRelationshipRecordView,
  date: Date | null,
): GuestLibraryCandidate {
  return {
    id: view.recordId,
    title: view.body,
    context: view.personLabel ? `About ${view.personLabel}` : null,
    body: null,
    belongsTo: view.sharedByName,
    date,
    scope: view.audience === "whole_household" ? "household" : "shared",
    householdNative: false,
    viewerIsOwner: view.viewerIsOwner,
  };
}

import type { RelationshipType } from "@tendnote/domain";
import type { PeopleStore, PersonDetailCounts } from "./types";

/**
 * Bounded, serialized data contracts for product surfaces. These deliberately
 * exclude owner IDs, timestamps, and storage rows so framework cache wrappers
 * can safely share only the caller-scoped view described by their key.
 */
export type PeopleListItemView = {
  id: string;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  birthday: string | null;
  profileBlurb: string | null;
  relationshipType: RelationshipType;
};

export type PersonDetailCoreView = {
  person: PeopleListItemView & {
    birthday: string | null;
    closenessLevel: number;
    profileBlurb: string | null;
  };
  counts: PersonDetailCounts;
};

function toListItemView(person: {
  id: string;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  birthday?: string | null;
  profileBlurb?: string | null;
  relationshipType: RelationshipType;
}): PeopleListItemView {
  return {
    id: person.id,
    displayName: person.displayName,
    firstName: person.firstName ?? null,
    lastName: person.lastName ?? null,
    birthday: person.birthday ?? null,
    profileBlurb: person.profileBlurb ?? null,
    relationshipType: person.relationshipType,
  };
}

/** Framework-neutral owner-scoped queries used by the People route cache layer. */
export function createPeopleProductQueries(
  store: Pick<PeopleStore, "getPersonDetailCore" | "searchPeople">,
) {
  return {
    async list(input: { ownerUserId: string; limit: number }): Promise<PeopleListItemView[]> {
      const people = await store.searchPeople({
        ownerUserId: input.ownerUserId,
        limit: input.limit,
      });
      return people.map(toListItemView);
    },

    async detail(input: {
      ownerUserId: string;
      personId: string;
    }): Promise<PersonDetailCoreView | null> {
      const core = await store.getPersonDetailCore(input);
      if (!core) return null;

      return {
        person: {
          ...toListItemView(core.person),
          closenessLevel: core.person.closenessLevel,
        },
        counts: core.counts,
      };
    },
  };
}

import { revalidatePath, updateTag } from "next/cache";
import { peopleCacheContract } from "./people-contract";

export type PeopleMutationScope =
  | { kind: "people-owner"; ownerUserId: string }
  | { kind: "people-collection"; ownerUserId: string }
  | { kind: "person"; ownerUserId: string; personId: string }
  | { kind: "person-visible-to-viewers"; personId: string };

/** Typed invalidation result emitted by user-originated People writes. */
export const peopleMutationScopes = {
  forCollection(input: { ownerUserId: string }): PeopleMutationScope[] {
    return [
      { kind: "people-owner", ownerUserId: input.ownerUserId },
      { kind: "people-collection", ownerUserId: input.ownerUserId },
    ];
  },

  forPerson(input: { ownerUserId: string; personId: string }): PeopleMutationScope[] {
    return [
      { kind: "people-owner", ownerUserId: input.ownerUserId },
      { kind: "people-collection", ownerUserId: input.ownerUserId },
      { kind: "person", ownerUserId: input.ownerUserId, personId: input.personId },
      { kind: "person-visible-to-viewers", personId: input.personId },
    ];
  },
};

export function invalidatePersonMutation(input: { ownerUserId: string; personId: string }) {
  const scopes = peopleMutationScopes.forPerson(input);
  updatePeopleMutationScopes(scopes);
  return scopes;
}

/**
 * Read-your-writes invalidation for Server Actions. The path call stays as the
 * deliberate migration safety net while tag coverage grows through route families.
 */
export function updatePeopleMutationScopes(scopes: PeopleMutationScope[]) {
  const personIds = new Set<string>();
  for (const scope of scopes) {
    switch (scope.kind) {
      case "people-owner":
        updateTag(peopleCacheContract.tags.owner(scope.ownerUserId));
        break;
      case "people-collection":
        updateTag(peopleCacheContract.tags.collection(scope.ownerUserId));
        break;
      case "person":
        updateTag(peopleCacheContract.tags.entity(scope.ownerUserId, scope.personId));
        personIds.add(scope.personId);
        break;
      case "person-visible-to-viewers":
        updateTag(peopleCacheContract.tags.allViewersEntity(scope.personId));
        personIds.add(scope.personId);
        break;
    }
  }

  revalidatePath("/people");
  for (const personId of personIds) {
    revalidatePath(`/people/${personId}`);
  }
}

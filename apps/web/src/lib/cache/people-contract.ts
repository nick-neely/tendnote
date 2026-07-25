type PeopleListCacheInput = { ownerUserId: string; limit: number };
type PersonDetailCacheInput = { callerUserId: string; personId: string };

function ownerTag(ownerUserId: string) {
  return `people:owner:${ownerUserId}`;
}

function collectionTag(ownerUserId: string) {
  return `${ownerTag(ownerUserId)}:list`;
}

function entityTag(ownerUserId: string, personId: string) {
  return `${ownerTag(ownerUserId)}:person:${personId}`;
}

function viewerTag(callerUserId: string) {
  return `people:viewer:${callerUserId}`;
}

function viewerEntityTag(callerUserId: string, personId: string) {
  return `${viewerTag(callerUserId)}:person:${personId}`;
}

// A person detail can be visible to more than its owner through a shared
// follow-up. The mutation path cannot safely guess every current viewer, so a
// per-record tag completes the caller-specific tags and expires every visible
// projection of that record without widening either read.
function allViewersEntityTag(personId: string) {
  return `people:visible-person:${personId}`;
}

/**
 * One central identity contract for the People route family. Cache wrappers use
 * these exact keys and tags; callers never hand-write cache strings.
 */
export const peopleCacheContract = {
  list(input: PeopleListCacheInput) {
    return {
      key: ["people", "list", input.ownerUserId, input.limit] as const,
      tags: [ownerTag(input.ownerUserId), collectionTag(input.ownerUserId)] as const,
    };
  },

  detail(input: PersonDetailCacheInput) {
    return {
      key: ["people", "detail", input.callerUserId, input.personId] as const,
      tags: [
        ownerTag(input.callerUserId),
        collectionTag(input.callerUserId),
        entityTag(input.callerUserId, input.personId),
        viewerTag(input.callerUserId),
        viewerEntityTag(input.callerUserId, input.personId),
        allViewersEntityTag(input.personId),
      ] as const,
    };
  },

  tags: {
    owner: ownerTag,
    collection: collectionTag,
    entity: entityTag,
    viewer: viewerTag,
    viewerEntity: viewerEntityTag,
    allViewersEntity: allViewersEntityTag,
  },
};

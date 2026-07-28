import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { tagsForAffectedScopes } from "./affected-scope-tags";

type PeopleListCacheInput = { ownerUserId: string };
type PersonDetailCacheInput = { callerUserId: string; personId: string };

/**
 * One tag contract for the People route family, expressed in the same affected
 * scopes its writes return. Cache identity comes from the cached function's args.
 */
export const peopleCacheContract = {
  list(input: PeopleListCacheInput) {
    return {
      tags: tagsForAffectedScopes([
        {
          kind: "owner-collection",
          collection: "people",
          ownerUserId: input.ownerUserId,
        },
      ]),
    };
  },

  detail(input: PersonDetailCacheInput) {
    return {
      tags: tagsForAffectedScopes([
        {
          kind: "owner-collection",
          collection: "people",
          ownerUserId: input.callerUserId,
        },
        {
          kind: "viewer-entity",
          entity: "person",
          entityId: input.personId,
          viewerUserId: input.callerUserId,
        },
        {
          kind: "visible-entity",
          entity: "person",
          entityId: input.personId,
        },
      ] satisfies AffectedScope[]),
    };
  },
};

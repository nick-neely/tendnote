import type { AffectedScope } from "../affected-scopes";

/**
 * Stable scopes for any write that can change a Person detail projection or the
 * People collection. The visible-entity scope covers household viewers whose
 * access is derived from a shared Follow-Up without guessing their identities.
 */
export function affectedScopesForPerson(input: {
  ownerUserId: string;
  personId: string;
}): AffectedScope[] {
  return [
    {
      kind: "owner-collection",
      collection: "people",
      ownerUserId: input.ownerUserId,
    },
    {
      kind: "viewer-entity",
      entity: "person",
      entityId: input.personId,
      viewerUserId: input.ownerUserId,
    },
    {
      kind: "visible-entity",
      entity: "person",
      entityId: input.personId,
    },
  ];
}

/** Dedupe the shared collection scope while retaining each changed Person. */
export function affectedScopesForPeople(input: {
  ownerUserId: string;
  personIds: readonly string[];
}): AffectedScope[] {
  const personIds = [...new Set(input.personIds)];
  if (personIds.length === 0) return [];

  return [
    {
      kind: "owner-collection",
      collection: "people",
      ownerUserId: input.ownerUserId,
    },
    ...personIds.flatMap((personId): AffectedScope[] => [
      {
        kind: "viewer-entity",
        entity: "person",
        entityId: personId,
        viewerUserId: input.ownerUserId,
      },
      {
        kind: "visible-entity",
        entity: "person",
        entityId: personId,
      },
    ]),
  ];
}

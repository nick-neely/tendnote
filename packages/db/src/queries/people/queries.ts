import { createPersonSchema, searchPeopleSchema, updatePersonSchema } from "@tendnote/domain";
import type {
  CreatePersonMutationInput,
  GetPersonProfileInput,
  PeopleStore,
  SearchPeopleQueryInput,
  UpdatePersonMutationInput,
  UpdatePersonPatch,
} from "./types";

/**
 * Shared owner-scoped person queries and mutations. Adapters provide storage;
 * this module owns product defaults, validation, and audit semantics.
 */
export function createPeopleQueries(store: PeopleStore) {
  return {
    async createPerson(input: CreatePersonMutationInput) {
      const parsed = createPersonSchema.parse(input);
      const person = await store.createPerson({
        ownerUserId: input.ownerUserId,
        displayName: parsed.displayName,
        firstName: parsed.firstName ?? null,
        lastName: parsed.lastName ?? null,
        birthday: parsed.birthday ?? null,
        relationshipType: parsed.relationshipType ?? "other",
        closenessLevel: parsed.closenessLevel ?? 3,
        profileBlurb: parsed.profileBlurb ?? null,
        source: parsed.source ?? "manual",
      });

      try {
        await store.createAuditLogEntry({
          ownerUserId: input.ownerUserId,
          action: "person.create",
          entityType: "person",
          entityId: person.id,
          metadataJson: { displayName: person.displayName, source: person.source },
        });
      } catch {
        // The person is already persisted; an audit-log failure must not lose it.
      }

      return person;
    },

    async updatePerson(input: UpdatePersonMutationInput) {
      // Validate and keep only the provided fields; `undefined` keys are dropped so
      // the store never overwrites an unmentioned column.
      const parsed = updatePersonSchema.parse(input);
      const patch = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => value !== undefined),
      ) as UpdatePersonPatch;

      const person = await store.updatePerson({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        patch,
      });

      if (!person) {
        return null;
      }

      try {
        await store.createAuditLogEntry({
          ownerUserId: input.ownerUserId,
          action: "person.update",
          entityType: "person",
          entityId: person.id,
          metadataJson: { fields: Object.keys(patch) },
        });
      } catch {
        // The update is already persisted; an audit-log failure must not lose it.
      }

      return person;
    },

    async searchPeople(input: SearchPeopleQueryInput) {
      const filters = searchPeopleSchema.parse(input);

      return store.searchPeople({
        ownerUserId: input.ownerUserId,
        query: filters.query,
        relationshipType: filters.relationshipType,
        limit: filters.limit,
      });
    },

    async getPersonProfile(input: GetPersonProfileInput) {
      return store.getPersonProfile(input);
    },
  };
}

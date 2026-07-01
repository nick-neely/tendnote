import type { ContactMethodStore, PersonEmailContactMethod } from "./types";

export type InMemoryContactMethodSeed = {
  /** Saved contact methods keyed by owner + person, for tests. */
  contactMethods?: Array<PersonEmailContactMethod & { ownerUserId: string; personId: string }>;
};

/** In-memory reader for a person's saved email contact methods (owner-scoped). */
export function createInMemoryContactMethodStore(
  seed: InMemoryContactMethodSeed = {},
): ContactMethodStore {
  const entries = seed.contactMethods ?? [];
  return {
    async listPersonEmailContactMethods({ ownerUserId, personId }) {
      return entries
        .filter((entry) => entry.ownerUserId === ownerUserId && entry.personId === personId)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
        .map(({ id, value, isPrimary }) => ({ id, value, isPrimary }));
    },
  };
}

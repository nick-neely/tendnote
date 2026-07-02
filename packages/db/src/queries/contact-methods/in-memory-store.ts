import { contactMethodDisplayValue, normalizeEmailContactValue } from "@tendnote/domain";
import {
  type ContactMethodStore,
  type PersonEmailContactMethod,
  toPersonEmailContactMethod,
} from "./types";

export type InMemoryContactMethodSeed = {
  /** Saved contact methods keyed by owner + person, for tests. */
  contactMethods?: Array<
    PersonEmailContactMethod & {
      ownerUserId: string;
      personId: string;
      type?: "email" | "phone";
    }
  >;
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
        .map((entry) =>
          toPersonEmailContactMethod({
            ...entry,
            normalizedValue: entry.normalizedValue ?? normalizeEmailContactValue(entry.value),
          }),
        );
    },

    async findOwnerContactMethodDuplicates({ ownerUserId, methods }) {
      return entries
        .filter((entry) => entry.ownerUserId === ownerUserId)
        .filter((entry) =>
          methods.some((method) => {
            const entryType = entry.type ?? "email";
            if (entryType !== method.type) {
              return false;
            }

            const entryNormalized =
              entry.normalizedValue ??
              (entryType === "email" ? normalizeEmailContactValue(entry.value) : null);
            return entryNormalized !== null && entryNormalized === method.normalizedValue;
          }),
        )
        .map(({ id, personId, type = "email", value, displayValue, normalizedValue }) => ({
          id,
          personId,
          type,
          value,
          displayValue: contactMethodDisplayValue({ value, displayValue }),
          normalizedValue:
            normalizedValue ?? (type === "email" ? normalizeEmailContactValue(value) : null),
        }));
    },

    async createContactMethod(input) {
      const entry = {
        id: `contact-method-${entries.length + 1}`,
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        type: input.type,
        value: input.value,
        displayValue: input.displayValue ?? input.value,
        normalizedValue: input.normalizedValue,
        isPrimary: input.isPrimary ?? false,
      };
      entries.push(entry);
      return {
        id: entry.id,
        personId: entry.personId,
        type: entry.type,
        value: entry.value,
        displayValue: contactMethodDisplayValue(entry),
        normalizedValue: entry.normalizedValue,
      };
    },
  };
}

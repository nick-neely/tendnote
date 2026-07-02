import { contactMethodDisplayValue, normalizeEmailContactValue } from "@tendnote/domain";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../client";
import { contactMethods, people } from "../../schema";
import { type ContactMethodStore, toPersonEmailContactMethod } from "./types";

/**
 * Drizzle-backed reader for a person's saved email contact methods. Owner scoping
 * is enforced by joining `people` and filtering on the owner, since contact methods
 * are owner-scoped through their person. Read-only: never inserts or updates a
 * contact method (ADR-0085 — a manually entered recipient is not saved here).
 */
export function createDrizzleContactMethodStore(): ContactMethodStore {
  return {
    async listPersonEmailContactMethods({ ownerUserId, personId }) {
      const rows = await getDb()
        .select({
          id: contactMethods.id,
          value: contactMethods.value,
          displayValue: contactMethods.displayValue,
          normalizedValue: contactMethods.normalizedValue,
          isPrimary: contactMethods.isPrimary,
        })
        .from(contactMethods)
        .innerJoin(people, eq(contactMethods.personId, people.id))
        .where(
          and(
            eq(contactMethods.personId, personId),
            eq(people.ownerUserId, ownerUserId),
            eq(contactMethods.type, "email"),
          ),
        )
        .orderBy(desc(contactMethods.isPrimary));

      return rows.map((row) =>
        toPersonEmailContactMethod({
          ...row,
          normalizedValue: row.normalizedValue ?? normalizeEmailContactValue(row.value),
        }),
      );
    },

    async findOwnerContactMethodDuplicates({ ownerUserId, methods }) {
      const emailValues = methods
        .filter((method) => method.type === "email" && method.normalizedValue)
        .map((method) => method.normalizedValue as string);
      const phoneValues = methods
        .filter((method) => method.type === "phone" && method.normalizedValue)
        .map((method) => method.normalizedValue as string);

      const filters = [
        emailValues.length > 0
          ? and(
              eq(contactMethods.type, "email"),
              inArray(contactMethods.normalizedValue, emailValues),
            )
          : undefined,
        phoneValues.length > 0
          ? and(
              eq(contactMethods.type, "phone"),
              inArray(contactMethods.normalizedValue, phoneValues),
            )
          : undefined,
      ].filter(Boolean);

      if (filters.length === 0) {
        return [];
      }

      const rows = await getDb()
        .select({
          id: contactMethods.id,
          personId: contactMethods.personId,
          type: contactMethods.type,
          value: contactMethods.value,
          displayValue: contactMethods.displayValue,
          normalizedValue: contactMethods.normalizedValue,
        })
        .from(contactMethods)
        .innerJoin(people, eq(contactMethods.personId, people.id))
        .where(and(eq(people.ownerUserId, ownerUserId), or(...filters)));

      return rows
        .filter((row) => row.type === "email" || row.type === "phone")
        .map((row) => ({
          ...row,
          type: row.type as "email" | "phone",
          displayValue: contactMethodDisplayValue(row),
        }));
    },
  };
}

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { contactMethods, people } from "../../schema";
import type { ContactMethodStore } from "./types";

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

      return rows;
    },
  };
}

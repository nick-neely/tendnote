import { personReferenceSchema } from "@tendnote/domain";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { personReferences } from "../../schema";
import { createDrizzleHouseholdStore } from "../households/drizzle-store";
import type { PersonReferenceStore } from "./types";

/**
 * The column is the full `visibility_record_kind` enum, while only the
 * household-native coordination families may host a reference. Parsing on the
 * way out narrows the type and, more usefully, means a row written for some
 * other family by a future migration is simply not returned rather than
 * flowing into a surface that assumes a host it cannot authorize.
 */
function toPersonReferences(rows: (typeof personReferences.$inferSelect)[]) {
  return rows.flatMap((row) => {
    const parsed = personReferenceSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export function createDrizzlePersonReferenceStore(): PersonReferenceStore {
  const household = createDrizzleHouseholdStore();

  return {
    listActiveHouseholdMembershipsForUser: household.listActiveHouseholdMembershipsForUser,
    listHouseholdRecordSharesForRecords: household.listHouseholdRecordSharesForRecords,
    createAuditLogEntry: household.createAuditLogEntry,

    async createPersonReference(input) {
      // Naming the same person twice on one plan is duplication, not a second
      // fact, so the unique index absorbs it instead of raising.
      const [reference] = await getDb()
        .insert(personReferences)
        .values(input)
        .onConflictDoNothing({
          target: [personReferences.recordKind, personReferences.recordId, personReferences.label],
        })
        .returning();
      if (reference) return personReferenceSchema.parse(reference);

      const [existing] = await getDb()
        .select()
        .from(personReferences)
        .where(
          and(
            eq(personReferences.recordKind, input.recordKind),
            eq(personReferences.recordId, input.recordId),
            eq(personReferences.label, input.label),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error("Failed to create person reference.");
      }
      return personReferenceSchema.parse(existing);
    },

    async listPersonReferencesForRecord(input) {
      // Anchored to one record. There is deliberately no household-wide or
      // label-keyed variant of this query anywhere in the adapter (ADR 0218).
      const rows = await getDb()
        .select()
        .from(personReferences)
        .where(
          and(
            eq(personReferences.recordKind, input.recordKind),
            eq(personReferences.recordId, input.recordId),
          ),
        )
        .orderBy(asc(personReferences.label));
      return toPersonReferences(rows);
    },

    async deletePersonReference(input) {
      await getDb()
        .delete(personReferences)
        .where(
          and(
            eq(personReferences.id, input.personReferenceId),
            eq(personReferences.recordKind, input.recordKind),
            eq(personReferences.recordId, input.recordId),
          ),
        );
    },
  };
}

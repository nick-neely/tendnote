import { randomUUID } from "node:crypto";
import type { PersonReference } from "@tendnote/domain";
import { createInMemoryHouseholdStore } from "../households/in-memory-store";
import type { HouseholdAuditLogEntry } from "../households/types";
import type { PersonReferenceStore } from "./types";

/**
 * `householdStore` is injectable so a cross-domain composition can share one
 * membership and share registry across every family it drives, matching the
 * Asset, General Action, and Gift Plan stores. A second household instance would
 * let two domains disagree about who is a member, which is the one thing an
 * isolation suite must not simulate away.
 */
export function createInMemoryPersonReferenceStore(
  householdStore: ReturnType<typeof createInMemoryHouseholdStore> = createInMemoryHouseholdStore(),
): PersonReferenceStore & {
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<HouseholdAuditLogEntry[]>;
  createHouseholdWorkspace: ReturnType<
    typeof createInMemoryHouseholdStore
  >["createHouseholdWorkspace"];
  createHouseholdMembership: ReturnType<
    typeof createInMemoryHouseholdStore
  >["createHouseholdMembership"];
  getHouseholdMembership: ReturnType<typeof createInMemoryHouseholdStore>["getHouseholdMembership"];
  updateHouseholdMembership: ReturnType<
    typeof createInMemoryHouseholdStore
  >["updateHouseholdMembership"];
  /** Every row, for tests that need to assert nothing was left behind. */
  allPersonReferences: () => PersonReference[];
} {
  const household = householdStore;
  const references = new Map<string, PersonReference>();

  return {
    ...household,
    async createPersonReference(input) {
      const duplicate = [...references.values()].find(
        (reference) =>
          reference.recordKind === input.recordKind &&
          reference.recordId === input.recordId &&
          reference.label === input.label,
      );
      if (duplicate) return duplicate;

      const now = new Date();
      const reference: PersonReference = {
        ...input,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      references.set(reference.id, reference);
      return reference;
    },
    async listPersonReferencesForRecord(input) {
      return [...references.values()]
        .filter(
          (reference) =>
            reference.recordKind === input.recordKind && reference.recordId === input.recordId,
        )
        .sort((left, right) => left.label.localeCompare(right.label));
    },
    async deletePersonReference(input) {
      const reference = references.get(input.personReferenceId);
      if (
        reference &&
        reference.recordKind === input.recordKind &&
        reference.recordId === input.recordId
      ) {
        references.delete(input.personReferenceId);
      }
    },
    allPersonReferences() {
      return [...references.values()];
    },
  };
}

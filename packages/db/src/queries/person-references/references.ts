import type { PersonReference } from "@tendnote/domain";
import { normalizePersonReferenceLabel, PersonReferenceValidationError } from "@tendnote/domain";
import { z } from "zod";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import type { PersonReferenceHost, PersonReferenceStore } from "./types";

/** Turns the label schema's own wording into a user-safe refusal. */
function labelRefusal(error: unknown): PersonReferenceValidationError {
  const message =
    error instanceof z.ZodError
      ? (error.issues[0]?.message ?? "Add a name for this person.")
      : "Add a name for this person.";
  return new PersonReferenceValidationError(message);
}

/**
 * Person References: a household-native coordination record naming an external
 * person, and nothing more.
 *
 * Every entry point takes the containing record and proves the caller's access
 * to *it* — mutations need `update`, reads need `view` — so a reference is
 * reachable exactly when its host is, and inherits the host's visibility
 * without storing any of its own. No entry point accepts a person id, returns
 * one, or searches by label, so there is no operation here that could query,
 * merge, or disclose another member's private People (ADR 0218).
 */
export function createPersonReferences(store: PersonReferenceStore) {
  const prover = createHouseholdAuthorizationProver(store);

  /**
   * Throws the one opaque error for every refusal, so a caller cannot use a
   * reference call to discover whether a coordination record exists.
   */
  async function requireHostAuthority(
    actorUserId: string,
    host: PersonReferenceHost,
  ): Promise<void> {
    await prover.requireRecordAccess({
      callerUserId: actorUserId,
      operation: "update",
      record: host,
    });
  }

  return {
    /**
     * Adds a deliberately supplied name to one coordination record.
     *
     * The label is normalized and validated here rather than at the surface:
     * an Eve tool, a Calendar handoff, and a form all reach this function, and
     * the rule that a reference is a name and not contact data has to hold for
     * all three.
     */
    async addPersonReference(input: {
      actorUserId: string;
      host: PersonReferenceHost;
      label: string;
    }): Promise<PersonReference> {
      await requireHostAuthority(input.actorUserId, input.host);

      let label: string;
      try {
        label = normalizePersonReferenceLabel(input.label);
      } catch (error) {
        throw labelRefusal(error);
      }

      const reference = await store.createPersonReference({
        householdId: input.host.householdId,
        recordKind: input.host.kind,
        recordId: input.host.id,
        label,
        createdByUserId: input.actorUserId,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.actorUserId,
        action: "person_reference.add",
        entityType: input.host.kind,
        entityId: input.host.id,
        // The label itself is not audited. Who named someone on a shared plan
        // is workspace history; what they called them is the record's content,
        // and copying it into a second store would be a second place to leak it.
        metadataJson: { householdId: input.host.householdId, personReferenceId: reference.id },
      });

      return reference;
    },

    /** Removes one reference from its own record. Host authority, host rules. */
    async removePersonReference(input: {
      actorUserId: string;
      host: PersonReferenceHost;
      personReferenceId: string;
    }): Promise<void> {
      await requireHostAuthority(input.actorUserId, input.host);
      await store.deletePersonReference({
        recordKind: input.host.kind,
        recordId: input.host.id,
        personReferenceId: input.personReferenceId,
      });
      await store.createAuditLogEntry({
        ownerUserId: input.actorUserId,
        action: "person_reference.remove",
        entityType: input.host.kind,
        entityId: input.host.id,
        metadataJson: {
          householdId: input.host.householdId,
          personReferenceId: input.personReferenceId,
        },
      });
    },

    /**
     * The references on one record, for a caller who may see that record.
     *
     * Returns an empty list rather than throwing when access is refused: a
     * reference list is part of a record's content, and a caller who cannot see
     * the record should find nothing here rather than an error that confirms
     * there was something to hide.
     */
    async listPersonReferences(input: {
      actorUserId: string;
      host: PersonReferenceHost;
      purpose?: "direct" | "ambient";
    }): Promise<PersonReference[]> {
      const proof = await prover.proveRecordAccess({
        callerUserId: input.actorUserId,
        operation: "view",
        purpose: input.purpose,
        record: input.host,
      });
      if (!proof.authorized) return [];

      return store.listPersonReferencesForRecord({
        recordKind: input.host.kind,
        recordId: input.host.id,
      });
    },
  };
}

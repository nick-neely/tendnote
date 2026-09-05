import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../client";
import { people, personUpdates } from "../../schema";
import type { PeopleStore } from "./types";
import {
  nextPersonRevision,
  personUpdateChanges,
  personUpdateStatus,
  previousPersonValues,
} from "./update-contract";

type UpdateStore = Pick<
  PeopleStore,
  "updatePerson" | "getLatestPersonUpdate" | "undoPersonUpdate" | "getPersonUpdateStatus"
>;
const ownedPerson = (ownerUserId: string, personId: string) =>
  and(eq(people.id, personId), eq(people.ownerUserId, ownerUserId));

/** The person row lock serializes both writes and inverses; the inverse commits with the edit. */
export function createPersonUpdateStore(): UpdateStore {
  return {
    async updatePerson({ ownerUserId, personId, patch }) {
      return getDb().transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(people)
          .where(ownedPerson(ownerUserId, personId))
          .for("update");
        if (!current) return null;
        const changes = personUpdateChanges(current, patch);
        if (!changes.length) return { ...current, update: null };
        const revision = nextPersonRevision(current.updatedAt);
        const [person] = await tx
          .update(people)
          .set({ ...patch, updatedAt: revision })
          .where(ownedPerson(ownerUserId, personId))
          .returning();
        if (!person) throw new Error("Person update failed.");
        const updateId = randomUUID();
        const values = { personId, updateId, expectedUpdatedAt: revision, changes, undoneAt: null };
        await tx
          .insert(personUpdates)
          .values(values)
          .onConflictDoUpdate({ target: personUpdates.personId, set: values });
        return { ...person, update: { target: { personId, updateId }, changes } };
      });
    },
    async getLatestPersonUpdate({ ownerUserId, personId }) {
      const [row] = await getDb()
        .select({ updateId: personUpdates.updateId, changes: personUpdates.changes })
        .from(personUpdates)
        .innerJoin(people, eq(people.id, personUpdates.personId))
        .where(
          and(
            ownedPerson(ownerUserId, personId),
            isNull(personUpdates.undoneAt),
            eq(people.updatedAt, personUpdates.expectedUpdatedAt),
          ),
        );
      return row ? { target: { personId, updateId: row.updateId }, changes: row.changes } : null;
    },
    async getPersonUpdateStatus({ ownerUserId, personId, updateId }) {
      const [row] = await getDb()
        .select({ revision: people.updatedAt, receipt: personUpdates })
        .from(people)
        .leftJoin(personUpdates, eq(people.id, personUpdates.personId))
        .where(ownedPerson(ownerUserId, personId));
      return {
        status: personUpdateStatus({
          updateId,
          currentRevision: row?.revision.getTime(),
          receipt: row?.receipt
            ? {
                updateId: row.receipt.updateId,
                revision: row.receipt.expectedUpdatedAt.getTime(),
                undone: Boolean(row.receipt.undoneAt),
              }
            : undefined,
        }),
      };
    },
    async undoPersonUpdate({ ownerUserId, personId, updateId }) {
      return getDb().transaction(async (tx) => {
        const [person] = await tx
          .select()
          .from(people)
          .where(ownedPerson(ownerUserId, personId))
          .for("update");
        if (!person) return { status: "unavailable" };
        const [update] = await tx
          .select()
          .from(personUpdates)
          .where(eq(personUpdates.personId, personId));
        if (!update) return { status: "superseded" };
        const status = personUpdateStatus({
          updateId,
          currentRevision: person.updatedAt.getTime(),
          receipt: {
            updateId: update.updateId,
            revision: update.expectedUpdatedAt.getTime(),
            undone: Boolean(update.undoneAt),
          },
        });
        if (status !== "available") return { status };
        await tx
          .update(people)
          .set({
            ...previousPersonValues(update.changes),
            updatedAt: nextPersonRevision(person.updatedAt),
          })
          .where(ownedPerson(ownerUserId, personId));
        // Clear private before/after values once consumed; retain a bounded idempotency receipt.
        await tx
          .update(personUpdates)
          .set({ undoneAt: new Date(), changes: [] })
          .where(eq(personUpdates.personId, personId));
        return { status: "applied" };
      });
    },
  };
}

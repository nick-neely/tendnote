import { type Person, type PersonUpdateChange, personUpdateFieldSchema } from "@tendnote/domain";
import type { UpdatePersonPatch } from "./types";

/** Compare validated profile values; omitted and unchanged fields are not edits. */
export function personUpdateChanges(
  person: Person,
  patch: UpdatePersonPatch,
): PersonUpdateChange[] {
  return personUpdateFieldSchema.options.flatMap((field) => {
    const after = patch[field];
    const before = person[field] ?? null;
    return after === undefined || after === before ? [] : [{ field, before, after }];
  });
}

export function previousPersonValues(changes: PersonUpdateChange[]): UpdatePersonPatch {
  return Object.fromEntries(
    changes.map(({ field, before }) => [field, before]),
  ) as UpdatePersonPatch;
}

/** Strictly advances even for writes in the same millisecond or a clock rollback. */
export function nextPersonRevision(current: Date): Date {
  return new Date(Math.max(Date.now(), current.getTime() + 1));
}

/** Compare the receipt, not field equality: an ABA edit must remain superseded. */
export function personUpdateStatus(input: {
  updateId: string;
  currentRevision?: number;
  receipt?: { updateId: string; revision: number; undone: boolean };
}): import("@tendnote/domain").PersonUpdateStatus {
  if (input.currentRevision === undefined) return "unavailable";
  if (!input.receipt || input.receipt.updateId !== input.updateId) return "superseded";
  if (input.receipt.undone) return "already_undone";
  return input.receipt.revision === input.currentRevision ? "available" : "superseded";
}

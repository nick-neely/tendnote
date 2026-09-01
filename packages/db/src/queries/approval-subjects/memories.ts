import { z } from "zod";
import { getMemory } from "../memories";
import { getPerson } from "../people";
import { type ApprovalSubjectDescribers, defineSubject, detail, subject } from "./define";

const memoryRef = z.object({ memoryId: z.uuid() });

/** Owner-keyed already: the entry point takes the owner, not a viewer. */
function ownMemory(input: { memoryId: string }, ownerUserId: string) {
  return getMemory({ ownerUserId, memoryId: input.memoryId });
}

export const memoryApprovalSubjects: ApprovalSubjectDescribers = {
  approve_suggested_memory: defineSubject({
    schema: memoryRef.extend({
      edit: z.object({ content: z.string().optional() }).loose().optional(),
    }),
    load: ownMemory,
    describe: (memory, input) =>
      subject("Save a suggested memory as a confirmed fact", [
        detail("Memory", memory.content),
        detail("Reworded to", input.edit?.content),
      ]),
  }),

  archive_memory: defineSubject({
    schema: memoryRef,
    load: ownMemory,
    describe: (memory) =>
      subject("Archive a memory", [
        detail("Memory", memory.content),
        "Archiving takes it out of recall and every normal view. The record is kept.",
      ]),
  }),

  capture_memory: defineSubject({
    schema: z.object({
      personId: z.uuid(),
      request: z.string().min(1),
      sensitivity: z.string().optional(),
    }),
    load: (input, ownerUserId) => getPerson({ ownerUserId, personId: input.personId }),
    describe: (person, input) =>
      subject(`Save a memory about ${person.displayName}`, [
        detail("Remember", input.request),
        detail("Sensitivity", input.sensitivity),
      ]),
  }),

  dismiss_suggested_memory: defineSubject({
    schema: memoryRef,
    load: ownMemory,
    describe: (memory) =>
      subject("Dismiss a suggested memory", [
        detail("Memory", memory.content),
        "A dismissed suggestion is not offered again.",
      ]),
  }),
};

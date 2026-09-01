import { z } from "zod";
import { getSelfContextFact } from "../context-facts";
import { type ApprovalSubjectDescribers, defineSubject, detail, subject } from "./define";

const factRef = z.object({ contextFactId: z.uuid() });

/**
 * The caller's own fact, read the way the Self Context management surfaces read
 * it: restricted facts included, because the owner deciding about their own fact
 * has to be able to see which one it is.
 *
 * The second argument is the store's caller verification. It is the owner the
 * policy already authenticated, so this cannot reach anybody else's fact.
 */
function ownFact(input: { contextFactId: string }, ownerUserId: string, includeArchived = false) {
  return getSelfContextFact(
    {
      callerUserId: ownerUserId,
      contextFactId: input.contextFactId,
      includeRestricted: true,
      includeArchived,
    },
    async () => ownerUserId,
  );
}

export const selfContextApprovalSubjects: ApprovalSubjectDescribers = {
  archive_self_context: defineSubject({
    schema: factRef.extend({ expectedUpdatedAt: z.string().optional() }),
    load: (input, ownerUserId) => ownFact(input, ownerUserId),
    describe: (fact) =>
      subject("Archive a fact about you", [
        detail(fact.category, fact.content),
        "It stops entering Eve's orientation. You can restore it in the app.",
      ]),
  }),

  restore_self_context: defineSubject({
    schema: factRef.extend({ expectedArchivedAt: z.string().optional() }),
    load: (input, ownerUserId) => ownFact(input, ownerUserId, true),
    describe: (fact) =>
      subject("Restore an archived fact about you", [
        detail(fact.category, fact.content),
        "It becomes active again and enters Eve's orientation.",
      ]),
  }),

  update_self_context: defineSubject({
    schema: factRef.extend({
      category: z.string(),
      content: z.string().min(1),
      sensitivity: z.string(),
      expectedUpdatedAt: z.string().optional(),
    }),
    load: (input, ownerUserId) => ownFact(input, ownerUserId),
    describe: (fact, input) =>
      subject("Replace a fact about you", [
        detail("Now", fact.content),
        detail("Becomes", input.content),
        detail("Category", input.category === fact.category ? undefined : input.category),
        detail(
          "Sensitivity",
          input.sensitivity === fact.sensitivity ? undefined : input.sensitivity,
        ),
      ]),
  }),
};

import { z } from "zod";
import { getDraft } from "../drafts";
import { getPerson } from "../people";
import {
  type ApprovalSubjectDescribers,
  defineSubject,
  detail,
  line,
  paragraphs,
  subject,
} from "./define";

const draftRef = z.object({ draftId: z.uuid() });

/** Owner-keyed already: the entry point takes the owner, not a viewer. */
function ownDraft(input: { draftId: string }, ownerUserId: string) {
  return getDraft({ ownerUserId, draftId: input.draftId });
}

/**
 * Who the draft is for, when the person is still there.
 *
 * A draft names a person id, and "save a draft to Gmail" is the one approval
 * where the wrong recipient is the whole risk — so the name is looked up rather
 * than left as a uuid, and a lookup that fails simply contributes no line.
 */
async function personName(ownerUserId: string, personId: string | null): Promise<string | null> {
  if (!personId) return null;
  try {
    const person = await getPerson({ ownerUserId, personId });
    return person?.displayName ?? null;
  } catch {
    return null;
  }
}

export const draftApprovalSubjects: ApprovalSubjectDescribers = {
  dismiss_draft: defineSubject({
    schema: draftRef,
    load: ownDraft,
    describe: (draft) =>
      subject("Throw away a message draft", [
        detail("Draft", draft.body),
        "Nothing is sent, and the notes it was built from are untouched.",
      ]),
  }),

  edit_draft_body: defineSubject({
    schema: draftRef.extend({ body: z.string().min(1) }),
    load: ownDraft,
    // Both sides in full: the point of the approval is the difference between
    // them, and a diff nobody can read is a rubber stamp. `Becomes` is the input
    // the card already renders, so it stays a labelled field; `Now` is the stored
    // wording the owner has to compare it against.
    describe: (draft, input) =>
      subject("Rewrite a message draft", [
        ...paragraphs("Now", draft.body),
        detail("Becomes", input.body),
        draft.status === "approved"
          ? "This draft is approved. Rewriting it returns it to an unapproved draft."
          : null,
      ]),
  }),

  save_draft_to_gmail: defineSubject({
    schema: draftRef.extend({ recipientEmail: z.string().min(1), subject: z.string().min(1) }),
    load: async (input, ownerUserId) => {
      const draft = await ownDraft(input, ownerUserId);
      if (!draft) return null;
      return { draft, person: await personName(ownerUserId, draft.personId) };
    },
    /**
     * The whole message, and why it needs no digest of its own.
     *
     * This is the one approval where the text itself leaves Tendnote, so the
     * body is shown in full rather than as a 160-character opening. The obvious
     * follow-on worry is that the body could change between this card and the
     * export - the Gmail service reads the CURRENT persisted body, not the one
     * described here - so it looks like the card should bind a hash of what it
     * showed.
     *
     * It does not need to. `editDraftBody` reverts an approved draft to `draft`
     * inside the same write that replaces the body, and the shared Gmail gate
     * authorizes purely on `status === "approved"`. A body edit between card and
     * execution therefore blocks the export instead of exporting text nobody
     * read, and the only way back to `approved` is the owner's own approval of
     * the new wording in the app. The binding already exists; it is the draft
     * lifecycle (`queries/drafts/lifecycle.ts`, `queries/gmail-drafts/gate.ts`).
     */
    describe: ({ draft, person }, input) =>
      subject("Save this message to your Gmail drafts", [
        line(`To: ${input.recipientEmail}${person ? ` (${person})` : ""}`),
        detail("Subject", input.subject),
        ...paragraphs("Message", draft.body),
        "It is saved as a Gmail draft. Nothing is sent.",
      ]),
  }),
};

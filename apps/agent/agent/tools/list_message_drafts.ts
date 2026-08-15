import { listDraftsForOwner, listDraftsForPerson } from "@tendnote/db/queries/drafts";
import { getPerson } from "@tendnote/db/queries/people";
import { type MessageDraft, messageDraftStatusSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * How many drafts one ask returns.
 *
 * Small on purpose, and smaller than the other list tools: a draft's whole body
 * travels (see `toModelOutput`), so five is what fits in a turn without crowding
 * out the conversation. The shared store applies no limit of its own.
 */
const DEFAULT_DRAFT_LIST_LIMIT = 5;

const inputSchema = z.object({
  personId: z
    .uuid()
    .optional()
    .describe(
      "Limit to one resolved person's drafts. Resolve identity with search_people first; omit to read the user's drafts across everyone.",
    ),
  statuses: z
    .array(messageDraftStatusSchema)
    .min(1)
    .max(4)
    .optional()
    .describe(
      "Optional status filter: draft (still being worked on), approved (the user marked it ready), dismissed (thrown away), sent_manually (the user sent it themselves). Omit for all of them.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(DEFAULT_DRAFT_LIST_LIMIT)
    .describe(`Max drafts to return, newest first. Defaults to ${DEFAULT_DRAFT_LIST_LIMIT}.`),
});

/** The people named by a page of drafts, resolved once each so nobody is a raw id. */
async function resolvePeople(
  ownerUserId: string,
  drafts: MessageDraft[],
): Promise<Map<string, string>> {
  const personIds = [...new Set(drafts.map((draft) => draft.personId))];
  const people = await Promise.all(
    personIds.map((personId) => getPerson({ ownerUserId, personId })),
  );
  return new Map(
    people.flatMap((person) => (person ? [[person.id, person.displayName] as const] : [])),
  );
}

/**
 * The root agent's way back to the drafts it wrote.
 *
 * `create_message_draft` persists a draft and hands back its id for exactly one
 * turn; after that the id was gone, so the only agent that could see a draft again
 * was `relationship_strategist`, whose copy of this read *requires* a personId it
 * has no way to obtain. The practical effect was that "what did I write to Sam?"
 * and "save that draft to Gmail" (which needs a `draftId` for an already-approved
 * draft) were both unanswerable one turn later.
 *
 * Read-only, and read-only in the strong sense: nothing here approves, edits,
 * dismisses, sends, or externalizes. `save_draft_to_gmail` is still the only path
 * out of Tendnote and it still runs the same explicit approval gate the web surface
 * does (ADR 0092).
 */
export default defineTool({
  description:
    "List the user's existing Tendnote message drafts, newest first — the private drafts Tendnote has written for them, with who each is for, its status, and its full text. Use for 'what drafts do I have?', 'what did I write to Sam?', 'is that birthday message still around?', and to recover the draft handle for a draft the user already approved and now wants saved to Gmail. Filter by a resolved personId (use search_people first) and/or by status (draft, approved, dismissed, sent_manually). These are Tendnote-only records: listing one sends nothing and creates nothing externally, and a status of 'approved' means the user marked it ready inside Tendnote, never that it was sent. Externalizing still goes through save_draft_to_gmail and its approval gate, with a recipient and subject the user confirms in this turn. Do NOT use this to write a new draft (`create_message_draft`, or the message_drafter subagent for a first pass). To change or clear one the user names, take its `draftId` into `edit_draft_body` or `dismiss_draft`; approving a draft and marking one sent manually stay in the app.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const personId = input.personId;

    const { shown, total, people } = await withModelSafeStoreErrors(async () => {
      const found = personId
        ? await listDraftsForPerson({ ownerUserId, personId, statuses: input.statuses })
        : await listDraftsForOwner({ ownerUserId, statuses: input.statuses });
      // Bound first, then resolve names: the lookup is one small read per distinct
      // person on the page the model actually sees, never per draft in the ledger.
      const page = found.slice(0, input.limit);
      return { shown: page, total: found.length, people: await resolvePeople(ownerUserId, page) };
    });

    return {
      personId: personId ?? null,
      count: shown.length,
      truncated: shown.length < total,
      drafts: shown.map((draft) => ({
        id: draft.id,
        person: { id: draft.personId, displayName: people.get(draft.personId) ?? null },
        channel: draft.channel,
        purpose: draft.purpose,
        status: draft.status,
        body: draft.body,
        // Labels and trust tiers only. The persisted grounding carries record ids the
        // subagent's older copy of this read leaked; nothing downstream consumes them,
        // so they stop here (ADR 0028).
        grounding: draft.sourceRefs.map((ref) => ({
          kind: ref.kind,
          trust: ref.trust,
          label: ref.label,
        })),
        updatedAt: draft.updatedAt.toISOString(),
      })),
    };
  },
  /**
   * The body travels whole, and the `draftId` with it.
   *
   * Whole because a truncated message is a message the model would relay as if it
   * were the user's: the default limit is five for exactly this reason, rather than
   * cutting the text and hoping the model notices. The id because
   * `save_draft_to_gmail` takes one and there is no other way to obtain it for a
   * draft written in an earlier turn — a guessed id is a failed call. The person id
   * does not travel; the name does.
   */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        count: output.count,
        truncated: output.truncated,
        drafts: output.drafts.map((draft) => ({
          draftId: draft.id,
          forWhom: draft.person.displayName,
          channel: draft.channel,
          purpose: draft.purpose,
          status: draft.status,
          body: draft.body,
          grounding: draft.grounding,
        })),
        guidance:
          output.count === 0
            ? "There are no drafts matching this. Say so plainly and offer to write one; do " +
              "not describe a draft you did not get back, and never claim one was sent."
            : "These are private Tendnote drafts and nothing more: 'approved' means the user " +
              "marked it ready in Tendnote, and none of them has been sent or exported. " +
              "`draftId` is the handle `save_draft_to_gmail` takes — copy it exactly, never " +
              "write it in your reply, and only externalize an already-approved draft when " +
              "the user asks in this turn and confirms the recipient and subject. Refer to " +
              "people by name.",
      },
    };
  },
});

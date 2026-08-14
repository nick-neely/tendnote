import { listDraftsForOwner, listDraftsForPerson } from "@tendnote/db/queries/drafts";
import { getPerson } from "@tendnote/db/queries/people";
import { type MessageDraft, messageDraftStatusSchema } from "@tendnote/domain";
import { z } from "zod";
import { type OwnerScopedContext, resolveOwnerUserId } from "../owner";
import { withModelSafeStoreErrors } from "../store-errors";

/**
 * How many drafts one ask returns.
 *
 * Small on purpose, and smaller than the other list tools: a draft's whole body
 * travels (see `toModelOutput`), so five is what fits in a turn without crowding
 * out the conversation. The shared store applies no limit of its own.
 */
const DEFAULT_DRAFT_LIST_LIMIT = 5;

/**
 * What one registration of the draft read is allowed to do with what it reads.
 *
 * `relationship_strategist` used to carry its own copy of this read. That copy
 * required a `personId` the subagent had no way to obtain, returned every draft
 * the person had ever had with no bound at all, and passed the persisted grounding
 * record ids straight to the model. It is gone: strategy reads through this same
 * bounded, name-resolving read, narrowed to the one person it was asked about.
 */
export type MessageDraftsToolOptions = {
  /** The opening of the description: who is asking and what for. */
  opening: string;
  /** What this caller may do next with a draft it just read. */
  onward: string;
  /**
   * Whether a draft may be read across everyone. The root agent answers "what
   * drafts do I have?", so it may; the strategist reasons about one person at a
   * time and has no use for the whole ledger.
   */
  personIdOptional: boolean;
  /**
   * Whether `draftId` reaches the model.
   *
   * True for the root agent, which has tools that take one (`save_draft_to_gmail`,
   * `edit_draft_body`, `dismiss_draft`) and no other way to obtain it for a draft
   * written in an earlier turn. False for the strategist, which has no such tool:
   * an id it cannot use is an id it can only leak.
   */
  draftHandles: boolean;
};

/**
 * The clause neither caller may drop. "Approved" is Tendnote-internal readiness and
 * nothing else, and reading a draft is not a step toward sending one.
 */
const TENDNOTE_ONLY_CLAUSE =
  "These are Tendnote-only records: listing one sends nothing and creates nothing externally, and a status of 'approved' means the user marked it ready inside Tendnote, never that it was sent.";

function inputSchemaFor(options: MessageDraftsToolOptions) {
  const personId = z
    .uuid()
    .describe(
      options.personIdOptional
        ? "Limit to one resolved person's drafts. Resolve identity with search_people first; omit to read the user's drafts across everyone."
        : "The resolved person whose existing Tendnote drafts should inform the answer. Resolve identity with search_people first.",
    );

  return z.object({
    personId: options.personIdOptional ? personId.optional() : personId,
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
}

type MessageDraftsInput = { personId?: string; statuses?: MessageDraft["status"][]; limit: number };

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
 * The shared read-only view of the drafts Tendnote has already written.
 *
 * Read-only in the strong sense: nothing here approves, edits, dismisses, sends, or
 * externalizes. `save_draft_to_gmail` is still the only path out of Tendnote and it
 * still runs the same explicit approval gate the web surface does (ADR 0092).
 */
const draftsRead = {
  async execute(input: MessageDraftsInput, ctx: OwnerScopedContext) {
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
};

type MessageDraftsOutput = Awaited<ReturnType<typeof draftsRead.execute>>;

export function messageDraftsTool(options: MessageDraftsToolOptions) {
  return {
    description: `${options.opening} ${TENDNOTE_ONLY_CLAUSE} ${options.onward}`,
    inputSchema: inputSchemaFor(options),
    execute: draftsRead.execute,
    /**
     * The body travels whole.
     *
     * Whole because a truncated message is a message the model would relay as if it
     * were the user's: the default limit is five for exactly this reason, rather than
     * cutting the text and hoping the model notices. A `draftId` travels only for a
     * caller that has a tool taking one - for that caller a guessed id is a failed
     * call and there is no other way to obtain it for a draft written in an earlier
     * turn. The person id never travels; the name does.
     */
    toModelOutput(output: MessageDraftsOutput) {
      return {
        type: "json" as const,
        value: {
          count: output.count,
          truncated: output.truncated,
          drafts: output.drafts.map((draft) => ({
            ...(options.draftHandles ? { draftId: draft.id } : {}),
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
                (options.draftHandles
                  ? "`draftId` is the handle `save_draft_to_gmail` takes - copy it exactly, never " +
                    "write it in your reply, and only externalize an already-approved draft when " +
                    "the user asks in this turn and confirms the recipient and subject. Refer to " +
                    "people by name."
                  : "Editing, approving, dismissing, and externalizing a draft all belong to the " +
                    "parent agent on the user's explicit instruction. Refer to people by name."),
        },
      };
    },
  };
}

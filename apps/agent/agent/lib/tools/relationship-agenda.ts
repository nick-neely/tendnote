import {
  getRelationshipAgenda,
  type RelationshipAgendaKind,
} from "@tendnote/db/queries/relationship-agenda";
import { z } from "zod";
import { type OwnerScopedContext, resolveOwnerUserId } from "../owner";
import { withModelSafeStoreErrors } from "../store-errors";

const agendaKindSchema = z.enum([
  "due_followup",
  "birthday",
  "review_item",
  "recent_context",
  "semantic_context",
  "suggested_followup",
]);

const inputSchema = z.object({
  windowStart: z
    .string()
    .describe("Inclusive agenda window start as an ISO 8601 string. Resolve relative dates first."),
  windowEnd: z
    .string()
    .describe("Inclusive agenda window end as an ISO 8601 string. Resolve relative dates first."),
  query: z
    .string()
    .optional()
    .describe("Optional broad user ask or short normalized phrase to guide agenda matching."),
  limit: z.number().int().min(1).max(50).optional().describe("Max agenda candidates to return."),
  includeKinds: z
    .array(agendaKindSchema)
    .optional()
    .describe(
      "Optional candidate kind filter for follow-ups, birthdays, review, recent, or semantic context.",
    ),
  directlyRequested: z
    .boolean()
    .optional()
    .describe("True only when the user directly asks for sensitive/restricted context."),
});

/**
 * The shared relationship agenda read model (PRD #51/#52), owner-scoped from the
 * session and read-only in the strong sense: it ranks existing relationship context
 * and never creates follow-ups, suggestions, prompting metadata, scans, or brief
 * records.
 */
const agendaRead = {
  async execute(input: z.infer<typeof inputSchema>, ctx: OwnerScopedContext) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const candidates = await withModelSafeStoreErrors(() =>
      getRelationshipAgenda({
        ownerUserId,
        windowStart: new Date(input.windowStart),
        windowEnd: new Date(input.windowEnd),
        query: input.query,
        limit: input.limit,
        includeKinds: input.includeKinds as RelationshipAgendaKind[] | undefined,
        directlyRequested: input.directlyRequested ?? false,
      }),
    );

    return {
      candidates: candidates.map((candidate) => ({
        ...candidate,
        dueAt: candidate.dueAt?.toISOString(),
      })),
      // Echo the requested window so the chat calendar can highlight exactly the
      // span the user asked about (e.g. "anything next week?") and anchor there.
      window: {
        start: input.windowStart,
        end: input.windowEnd,
      },
      component: {
        type: "relationship_agenda",
        resultCount: candidates.length,
      },
    };
  },
};

type AgendaOutput = Awaited<ReturnType<typeof agendaRead.execute>>;

/**
 * What one registration of the agenda read says about itself.
 *
 * The root agent and `relationship_strategist` used to carry hand-copied files that
 * drifted: the subagent's description lost the "never show raw ids" rule while its
 * projection started handing the model raw `sourceRefs` with nothing to say what
 * they were for. There is one read here now, and a caller chooses only how it is
 * framed and whether the ids it needs in order to act travel with it.
 */
export type RelationshipAgendaToolOptions = {
  description: string;
  /**
   * Whether the model view carries the ids the caller's own next tool call needs.
   *
   * False for the root agent, which reaches a person through `search_people` and a
   * source record through the person-context reads: an id in its view would be one
   * it could print and could not use. True for `relationship_strategist`, whose only
   * read is this one and whose only write is `propose_followup` - that call requires
   * a `personId` and a `sourceRecordId`, and without them here ADR 0124's whole path
   * is unreachable. Handles travel with the never-display rule attached, the same way
   * every other id-bearing result in the tree states it.
   */
  toolCallHandles: boolean;
};

const READ_ONLY_GUIDANCE =
  "This is read-only agenda context. Use propose_followup only for a grounded " +
  "Suggested Follow-Up review card; never treat agenda ranking itself as a mutation.";

const HANDLE_GUIDANCE =
  " `personId` and each `sourceRefs[].id` are handles for your next tool call: copy " +
  "one exactly, never invent one, and never write one in a reply. Name people by " +
  "their display name.";

const ROOT_GUIDANCE =
  "Don't relist the candidates - the card shows them. Say what stands out in a line " +
  "or two; these are candidates to consider, not work anyone is behind on.";

export function relationshipAgendaTool(options: RelationshipAgendaToolOptions) {
  return {
    description: options.description,
    inputSchema,
    execute: agendaRead.execute,
    // The model needs names, kinds, reasons, dates, and trust to write its reply.
    // Rank and the render scaffolding are for the chat component, so they stop here;
    // ids stop here too unless this caller has a tool that takes one. Channels still
    // receive the full structured output for rich rendering.
    toModelOutput(output: AgendaOutput) {
      return {
        type: "json" as const,
        value: {
          window: output.window,
          count: output.candidates.length,
          candidates: output.candidates.map((candidate) => ({
            person: candidate.personDisplayName ?? "unlinked record",
            kind: candidate.kind,
            title: candidate.title,
            reason: candidate.reason,
            due: candidate.dueAt ?? null,
            trust: candidate.trustLevel,
            sensitivity: candidate.sensitivity,
            visibility: candidate.visibilityLabel ?? null,
            visibilityChoice: candidate.visibilityChoice ?? null,
            ...(options.toolCallHandles
              ? { personId: candidate.personId, sourceRefs: candidate.sourceRefs }
              : {}),
          })),
          ...(options.toolCallHandles
            ? { guidance: READ_ONLY_GUIDANCE + HANDLE_GUIDANCE }
            : {
                rendered: "The agenda candidates are shown to the user in a card.",
                guidance: ROOT_GUIDANCE,
              }),
        },
      };
    },
  };
}

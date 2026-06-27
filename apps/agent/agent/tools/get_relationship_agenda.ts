import {
  getRelationshipAgenda,
  type RelationshipAgendaKind,
} from "@tendnote/db/queries/relationship-agenda";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

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
 * Thin Eve wrapper over the shared relationship agenda read model (PRD #51/#52).
 * The tool is read-only: it ranks existing relationship context and never creates
 * follow-ups, suggestions, prompting metadata, scans, or brief records.
 */
export default defineTool({
  description:
    "Read the user's owner-scoped relationship agenda for broad questions like 'anything coming up next week?', 'who deserves a thought today?', or 'what follow-ups are due soon?'. Pass a concrete windowStart/windowEnd, optional query, limit, includeKinds, and directlyRequested. This is read-only agenda ranking over existing context; never use it to create reminders, suggestions, scans, or brief artifacts. Return people by display name and never show raw ids.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const candidates = await getRelationshipAgenda({
      ownerUserId,
      windowStart: new Date(input.windowStart),
      windowEnd: new Date(input.windowEnd),
      query: input.query,
      limit: input.limit,
      includeKinds: input.includeKinds as RelationshipAgendaKind[] | undefined,
      directlyRequested: input.directlyRequested ?? false,
    });

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
  // The model only needs names, kinds, reasons, dates, and trust to write its
  // reply. Source-ref UUIDs, person ids, rank, and the render scaffolding are for
  // the chat component and your tool calls — strip them from the model's view so
  // they can't leak into a reply and don't crowd the context window. Channels
  // still receive the full structured output above for rich rendering.
  toModelOutput(output) {
    return {
      type: "json",
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
        })),
      },
    };
  },
});

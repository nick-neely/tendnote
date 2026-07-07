import { createGeneralAction } from "@tendnote/db/queries/general-actions";
import { generalActionLinkSchema, generalActionRecurrenceSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("The action itself, in the user's words (e.g. 'Replace the fridge water filter')."),
  notes: z
    .string()
    .optional()
    .describe("Optional extra detail. Omit if the title already says everything."),
  dueAt: z
    .string()
    .optional()
    .describe(
      "Optional concrete due date as an ISO 8601 string. Resolve relative phrases like 'next Friday' to a concrete date first; if the timing is genuinely ambiguous, ask instead of guessing. Omit for an unscheduled 'someday' action — a General Action does not need a date.",
    ),
  recurrence: generalActionRecurrenceSchema
    .nullish()
    .describe(
      "Optional simple cadence — repeat every `interval` `unit`s (e.g. {interval: 6, unit: 'month'}). Its presence makes this a Routine. Only for a genuine recurring chore ('every 6 months'), never for a one-off. Simple cadence only: no per-occurrence rules.",
    ),
  areaId: z
    .uuid()
    .optional()
    .describe("Optional Area (a flat life category) to file this under. Omit to leave it unfiled."),
  personIds: z
    .array(z.uuid())
    .optional()
    .describe(
      "Optional people this action is about — context links only, resolved with search_people first. Linking a person never turns this into a follow-up for them.",
    ),
  links: z
    .array(generalActionLinkSchema)
    .optional()
    .describe("Optional reference links (a URL with an optional label). Not file attachments."),
  sourceRecordId: z
    .uuid()
    .optional()
    .describe(
      "Optional grounding: the source record this action came from (e.g. a note you just logged). Omit for a plain user-created action.",
    ),
});

/**
 * Thin wrapper over the shared owner-scoped General Action lifecycle: creates an
 * ACTIVE `open` action directly, or a Routine when a cadence is present (ADRs 0144,
 * 0148, 0159). Only fires on an explicit user ask in the current turn — Eve never
 * invents an active action from its own initiative or from stale context; when the
 * user is only musing or asking for ideas, propose a review-gated suggestion instead
 * (`suggest_general_action`). The shared layer owner-scopes the write, defaults
 * visibility to private (fail-closed), and verifies grounding, Area, and people links
 * before attaching them. Returns a compact persisted reference, never a raw id in prose.
 */
export default defineTool({
  description:
    "Create an ACTIVE General Action (a durable to-do) directly, or a Routine when a recurring cadence is given. Only call this when the user explicitly asks to add/create/track an action in the current turn (e.g. 'add an action to replace the water filter', 'set up a routine to change the filters every 6 months') — never invent one on their behalf, and never from your own initiative or an inference. If the user is only brainstorming or asking you to plan, propose review-gated suggestions with suggest_general_action / plan_suggested_general_actions instead. A due date is optional (omit for an unscheduled 'someday' action); resolve relative timing to a concrete date, and ask if it is ambiguous. Resolve any people with search_people first — they are context links, not follow-ups. Returns the persisted action reference (id, title, status, timing, cadence); refer to it by its title, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const action = await createGeneralAction({
      ownerUserId,
      title: input.title,
      notes: input.notes ?? null,
      // Parsed here; the shared layer treats a General Action as unscheduled when absent.
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      recurrence: input.recurrence ?? null,
      areaId: input.areaId ?? null,
      personIds: input.personIds,
      links: input.links,
      sourceRecordId: input.sourceRecordId ?? null,
    });

    return { action: toGeneralActionRef(action) };
  },
  // The chat renders a confirmation card carrying the action's title, timing, and
  // cadence, so the model only acknowledges it — it must not reprint what the card shows.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        created: true,
        action: toGeneralActionModelRef(output.action),
        guidance:
          "It's on the active ledger and shown to the user as a card. Acknowledge it in one short sentence; don't restate the title, date, or cadence the card already shows.",
      },
    };
  },
});

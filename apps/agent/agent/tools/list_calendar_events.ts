import { readConnectedOwnerCalendar } from "@tendnote/db/queries/calendar";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { createOwnerCalendarReader } from "../lib/calendar";
import { runCalendarRead } from "../lib/calendar-read";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  daysAhead: z
    .number()
    .int()
    .min(0)
    .max(30)
    .optional()
    .describe("How many days ahead to include. Defaults to 7."),
  daysBack: z
    .number()
    .int()
    .min(0)
    .max(14)
    .optional()
    .describe(
      "How many days back to include, to catch a meeting that just happened. Defaults to 1.",
    ),
  query: z
    .string()
    .max(200)
    .optional()
    .describe("Optional free-text filter, e.g. a person's name or a topic."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum events to return, soonest first. Defaults to 20."),
});

/**
 * Eve's narrow, READ-ONLY live Google Calendar read (Phase 2C, ADR-0074). It
 * returns minimized event summaries for a bounded window from the owner's primary
 * calendar through the shared cache-aside seam, which gates on the Calendar
 * connection being connected and degrades gracefully when Google is unavailable.
 *
 * It performs NO durable writes: it cannot create memories, source records,
 * follow-ups, drafts, or external sends. The output is provider-derived context,
 * not approved Tendnote memory.
 */
export default defineTool({
  description:
    "Read the user's upcoming and recent Google Calendar events (read-only). Use for 'what's on my calendar?', 'when am I meeting <person>?', 'what did I have this morning?'. Returns minimized events (title, time, who else is on it, location) from the primary calendar for a bounded window. This is provider-derived context, NOT saved Tendnote memory: never present it as approved facts, and never create reminders, memories, or drafts from it without the user's explicit go-ahead. This tool cannot create, move, update, delete, or RSVP to Calendar events; for rescheduling requests, say the user must make the Calendar change themselves, while you can help identify the event or draft a message. If Calendar isn't connected or is temporarily unavailable, say so plainly — do not invent events.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const reader = createOwnerCalendarReader(ownerUserId);

    // The shared seam already turns "not connected" and "provider is down" into
    // framed results, so this wrapper only catches what is left: a store failure
    // reading the connection itself, which the model must not see raw.
    return withModelSafeStoreErrors(() =>
      runCalendarRead(
        { ownerUserId, input, now: new Date() },
        { read: (request) => readConnectedOwnerCalendar(request, { reader }) },
      ),
    );
  },
  // The structured output is already minimized and id-free; the model sees the
  // same provider-derived, read-only framing the tool returns.
  toModelOutput(output) {
    return { type: "json", value: output };
  },
});

import { readConnectedOwnerCalendar } from "@tendnote/db/queries/calendar";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { createOwnerCalendarReader } from "../../../lib/calendar";
import { runCalendarRead } from "../../../lib/calendar-read";
import { resolveOwnerUserId } from "../../../lib/owner";

const inputSchema = z.object({
  daysAhead: z.number().int().min(0).max(30).optional().describe("Days ahead to include."),
  daysBack: z
    .number()
    .int()
    .min(0)
    .max(14)
    .optional()
    .describe("Days back to include for recently completed meetings."),
  query: z.string().max(200).optional().describe("Optional person/topic filter."),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum events to return."),
});

export default defineTool({
  description:
    "Read recent and upcoming owner Calendar events for private relationship strategy. This is provider-derived, read-only context; never create, move, update, delete, or RSVP to Calendar events. Never create reminders, memories, drafts, or external actions from Calendar context without explicit owner approval.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const reader = createOwnerCalendarReader(ownerUserId);

    return runCalendarRead(
      { ownerUserId, input, now: new Date() },
      { read: (request) => readConnectedOwnerCalendar(request, { reader }) },
    );
  },
  toModelOutput(output) {
    return { type: "json" as const, value: output };
  },
});

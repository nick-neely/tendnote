import { defineTool } from "eve/tools";
import { relationshipAgendaTool } from "../../../lib/tools/relationship-agenda";

/**
 * The strategist's registration of the shared agenda read. Same read, same owner
 * scoping, same read-only guarantee as the root's; it differs only in framing and
 * in carrying the handles `propose_followup` needs (ADR 0124).
 */
export default defineTool(
  relationshipAgendaTool({
    description:
      "Read the caller's visible relationship agenda for private strategy requests. Visible context includes the caller's private records plus selected-member and whole-household records the caller can view. This is read-only: it ranks existing context and never creates reminders, suggestions, scans, briefs, drafts, memories, source records, or external actions. Preserve visibility/provenance language when it affects trust or actionability. Each candidate carries the `personId` and source refs a grounded propose_followup call needs; use them as handles only and name people by display name, never by a raw id.",
    toolCallHandles: true,
  }),
);

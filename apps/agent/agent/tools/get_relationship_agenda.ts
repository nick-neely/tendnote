import { defineTool } from "eve/tools";
import { relationshipAgendaTool } from "../lib/tools/relationship-agenda";

/**
 * Thin Eve wrapper over the shared relationship agenda read model (PRD #51/#52).
 * The tool is read-only: it ranks existing relationship context and never creates
 * follow-ups, suggestions, prompting metadata, scans, or brief records.
 */
export default defineTool(
  relationshipAgendaTool({
    description:
      "Read the user's visible relationship agenda for broad questions like 'anything coming up next week?', 'who deserves a thought today?', 'who should I prioritize?', or 'what follow-ups are due soon?'. Visible context includes the caller's private records plus selected-member and whole-household records the caller can view. The root agent may use this directly for lightweight read-only agenda and prioritization answers; use relationship_strategist for deeper synthesis or review-gated follow-up proposals. Pass a concrete windowStart/windowEnd, optional query, limit, and includeKinds. Setting directlyRequested pauses the call for the user to approve including restricted candidates; if they decline, work from the ordinary ones instead of asking again. This is read-only agenda ranking over existing context; never use it to create reminders, suggestions, scans, or brief artifacts. Preserve visibility/provenance language when it affects trust or actionability. Return people by display name and never show raw ids.",
    // The root reaches records through search_people and the person-context reads,
    // so an id in its agenda view would be one it could print and could not use.
    toolCallHandles: false,
    // The owner is on the other end of this session, so a restricted request can
    // be put to them.
    restrictedContext: "owner-approval",
  }),
);

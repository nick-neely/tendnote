import { defineTool } from "eve/tools";
import { searchPeopleTool } from "../../../lib/tools/search-people";

/**
 * The strategist's own identity lookup, and the reason its one write is reachable
 * at all.
 *
 * `propose_followup` requires a `personId`. A subagent inherits nothing from the
 * root - not the conversation, not the person the user was talking about - so
 * without this the only personId it could ever hold was one the parent happened to
 * put in the delegated message, and there was nothing it could do when the parent
 * did not (ADR 0124). The parent still passes a resolved id for ordinary
 * delegations; this is the fallback, not the norm.
 */
export default defineTool(
  searchPeopleTool({
    description:
      "Resolve a name the delegated message mentioned into the personId your other tools need. Pass the name as `query`; leave `relationshipType` unset unless the request itself names a relationship category, because a wrong type filters out real matches. Returns stored Tendnote people plus requiresDisambiguation: when true, more than one person matched, so say which people matched and hand the choice back to the parent agent instead of guessing. You cannot create a person; when nobody matches, say so plainly and stop.",
  }),
);

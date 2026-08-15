import { defineTool } from "eve/tools";
import { searchPeopleTool } from "../lib/tools/search-people";

/** The root agent's registration of the shared identity lookup (ADR 0033). */
export default defineTool(
  searchPeopleTool({
    description:
      "Find people before linking context or adding anyone. Pass the name the user mentioned as `query`. Only set `relationshipType` when the user explicitly asks to filter by a relationship category (e.g. 'my colleagues'); never guess or default it, because a wrong type filters out real matches. Omit it for plain name lookups. Returns stored Tendnote people plus requiresDisambiguation: when true, more than one person matched, so ask the user which one they mean instead of guessing or creating a new person.",
  }),
);

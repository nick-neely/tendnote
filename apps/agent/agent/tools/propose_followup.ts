import { defineTool } from "eve/tools";
import { proposeFollowupTool } from "../lib/tools/propose-followup";

/**
 * The root agent's registration of the shared review-gated suggestion path
 * (PRD #42, ADR-0006). It proposes only in an explicit flow and never creates an
 * active reminder; `create_followup` is the tool for that, on an explicit ask.
 */
export default defineTool(
  proposeFollowupTool({
    whenToUse:
      "Use this only in an explicit flow (just logged a note, reviewing a source record or memory, viewing a person, or the user asked 'should I follow up?').",
    groundingHint:
      "the note you just logged, the source record under review, or one returned by get_person_context/search.",
  }),
);

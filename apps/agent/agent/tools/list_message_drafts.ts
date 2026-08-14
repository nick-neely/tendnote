import { defineTool } from "eve/tools";
import { messageDraftsTool } from "../lib/tools/message-drafts";

/**
 * The root agent's way back to the drafts it wrote.
 *
 * `create_message_draft` persists a draft and hands back its id for exactly one
 * turn; after that the id was gone, so the only agent that could see a draft again
 * was `relationship_strategist`, whose copy of this read *required* a personId it
 * had no way to obtain. The practical effect was that "what did I write to Sam?"
 * and "save that draft to Gmail" (which needs a `draftId` for an already-approved
 * draft) were both unanswerable one turn later.
 */
export default defineTool(
  messageDraftsTool({
    opening:
      "List the user's existing Tendnote message drafts, newest first - the private drafts Tendnote has written for them, with who each is for, its status, and its full text. Use for 'what drafts do I have?', 'what did I write to Sam?', 'is that birthday message still around?', and to recover the draft handle for a draft the user already approved and now wants saved to Gmail. Filter by a resolved personId (use search_people first) and/or by status (draft, approved, dismissed, sent_manually).",
    onward:
      "Externalizing still goes through save_draft_to_gmail and its approval gate, with a recipient and subject the user confirms in this turn. Do NOT use this to write a new draft (`create_message_draft`, or the message_drafter subagent for a first pass). To change or clear one the user names, take its `draftId` into `edit_draft_body` or `dismiss_draft`; approving a draft and marking one sent manually stay in the app.",
    personIdOptional: true,
    draftHandles: true,
  }),
);

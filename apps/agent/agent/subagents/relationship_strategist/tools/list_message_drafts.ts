import { defineTool } from "eve/tools";
import { messageDraftsTool } from "../../../lib/tools/message-drafts";

/**
 * The strategist's registration of the shared draft read, narrowed to one person:
 * outreach that has already been started changes what is worth recommending next,
 * and nothing beyond that person is in scope for the recommendation.
 */
export default defineTool(
  messageDraftsTool({
    opening:
      "Read the existing Tendnote message drafts for one resolved person so a recommendation can account for outreach the user has already started. Resolve the person with search_people when the delegated message did not carry a personId.",
    onward:
      "This read is where drafts stop for you: creating, editing, approving, dismissing, externalizing, and sending all require the parent agent and the user's explicit instruction. Hand a durable change back rather than describing one as done.",
    personIdOptional: false,
    draftHandles: false,
  }),
);

import { disableTool } from "eve/tools";

/**
 * Every durable write goes through an owner-scoped `@tendnote/db` entry point so
 * it carries visibility, audience, and audit. A filesystem write would be a
 * record the product cannot see, scope, or review.
 */
export default disableTool();

import { disableTool } from "eve/tools";

/**
 * Cooperative cancellation of background tasks, root-session only. Disabled for
 * the same reason as `task_update`: Tendnote spawns no background tasks, so this
 * would be an unused control surface that quietly becomes live if delegation is
 * ever turned back on.
 */
export default disableTool();

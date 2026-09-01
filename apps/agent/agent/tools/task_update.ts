import { disableTool } from "eve/tools";

/**
 * Background-task progress reporting, available only to a delegated task child.
 * Tendnote has no delegated background tasks: the root disables the framework
 * `agent` tool and the four declared subagents run inline. Disabled so the
 * capability cannot arrive silently alongside a future decision to re-enable
 * delegation.
 */
export default disableTool();

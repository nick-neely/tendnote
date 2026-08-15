import { disableTool } from "eve/tools";

/**
 * Eve resolves its default harness per agent node, so a declared subagent gets
 * its own `web_search` unless it disables one here. The root keeps this
 * provider-managed capability only in authenticated web chat.
 */
export default disableTool();

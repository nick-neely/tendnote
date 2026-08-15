import { disableTool } from "eve/tools";

/**
 * Eve resolves its default harness per agent node, so a declared subagent gets
 * its own `web_search` unless it disables one here. See `agent/tools/web_search.ts`.
 */
export default disableTool();

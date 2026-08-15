import { disableTool } from "eve/tools";

/**
 * Eve resolves its default harness per agent node, so a declared subagent gets
 * its own `glob` unless it disables one here. See `agent/tools/glob.ts`.
 */
export default disableTool();

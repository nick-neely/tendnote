import { disableTool } from "eve/tools";

/**
 * Eve resolves its default harness per agent node, so a declared subagent gets
 * its own `grep` unless it disables one here. See `agent/tools/grep.ts`.
 */
export default disableTool();

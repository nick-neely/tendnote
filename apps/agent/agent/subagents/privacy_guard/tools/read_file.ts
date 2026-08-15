import { disableTool } from "eve/tools";

/**
 * Eve resolves its default harness per agent node, so a declared subagent gets
 * its own `read_file` unless it disables one here. See `agent/tools/read_file.ts`.
 */
export default disableTool();

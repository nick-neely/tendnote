import { disableTool } from "eve/tools";

/**
 * Eve resolves its default harness per agent node, so a declared subagent gets
 * its own `bash` unless it disables one here. See `agent/tools/bash.ts`.
 */
export default disableTool();

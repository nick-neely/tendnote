import { disableTool } from "eve/tools";

/**
 * The framework `agent` tool spawns a full copy of the root agent, with the root
 * instructions and all root tools. Delegation is meant to run through the four
 * declared subagents, each carrying a deliberately narrow toolset; a self-copy
 * would route around that narrowing entirely.
 */
export default disableTool();

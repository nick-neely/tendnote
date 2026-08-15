import { disableTool } from "eve/tools";

/**
 * Same reason as `glob`: content search belongs to the owner-scoped search tools,
 * which apply visibility and trust filtering. A filesystem grep applies neither.
 */
export default disableTool();

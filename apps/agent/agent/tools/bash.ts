import { disableTool } from "eve/tools";

/**
 * Tendnote configures no sandbox, and nothing in the product needs shell access.
 * Leaving the framework default enabled would hand the model an unaudited
 * execution path next to 52 owner-scoped tools.
 */
export default disableTool();

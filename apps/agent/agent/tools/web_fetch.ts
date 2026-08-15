import { disableTool } from "eve/tools";

/**
 * Answers must come from returned records, never the open internet. Fetching a
 * URL would also pull untrusted text straight into the turn, which is exactly the
 * injection surface the untrusted-data framing exists to bound.
 */
export default disableTool();

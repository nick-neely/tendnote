import { disableTool } from "eve/tools";

/**
 * Filesystem discovery has no Tendnote meaning: retrieval is the search family
 * over owner-scoped records. Disabled alongside `read_file` so no path exists to
 * enumerate a filesystem the agent must not read.
 */
export default disableTool();

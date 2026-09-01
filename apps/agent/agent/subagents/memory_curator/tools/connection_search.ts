import { disableTool } from "eve/tools";

/**
 * `connection_search` resolves connection-backed tools into the model's toolset
 * at step start, so whatever an installed Eve connection exposes becomes
 * callable without passing through a Tendnote tool. Every external capability
 * Tendnote grants is an authored tool with its own owner scoping and approval
 * path (Gmail drafts, Calendar reads, Discord delivery); a framework-resolved
 * connection surface would sit beside all of it, unscoped and unreviewed.
 */
export default disableTool();

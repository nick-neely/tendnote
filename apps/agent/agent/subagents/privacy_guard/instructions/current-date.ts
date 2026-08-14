import { currentDateAnchor } from "../../../lib/current-date-anchor";
import { resolveAuthenticatedCaller } from "../../../lib/self-context-orientation";

/**
 * This subagent's own date anchor. A declared subagent inherits nothing from the
 * root, so without this file it had no idea what day it was and resolved relative
 * dates by guessing. The caller rule is the authenticated-caller one rather than the
 * root's orientation rule, which refuses child sessions by design: a subagent turn
 * runs under the owner's own principal, so this reads the same owner row its tools
 * already scope every read by, and falls back to UTC when there is no such caller.
 */
export default currentDateAnchor(resolveAuthenticatedCaller);

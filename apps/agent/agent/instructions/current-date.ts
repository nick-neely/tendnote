import { currentDateAnchor } from "../lib/current-date-anchor";
import { resolveOrientationCaller } from "../lib/self-context-orientation";

/**
 * The root agent's date anchor.
 *
 * The caller check is the orientation one on purpose. It is stricter than a date
 * anchor needs - it also refuses child-agent sessions, which cannot reach this file
 * anyway - but reusing it keeps one definition of "a directly authenticated human
 * owner" in the root agent, and being refused here costs only the zone, never the
 * date. Each subagent registers the same anchor with the authenticated-caller rule,
 * because a subagent session is a child session by definition.
 */
export default currentDateAnchor(resolveOrientationCaller);

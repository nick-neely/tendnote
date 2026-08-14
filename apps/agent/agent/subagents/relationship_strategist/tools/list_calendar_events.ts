import { defineTool } from "eve/tools";
import { calendarEventsTool } from "../../../lib/tools/calendar-events";

/**
 * The strategist's registration of the same read-only Calendar read the root agent
 * has. Strategy may fold in a meeting that just happened or is about to; it may not
 * write to Calendar, and nothing here can.
 */
export default defineTool(calendarEventsTool());

import { defineTool } from "eve/tools";
import { calendarEventsTool } from "../lib/tools/calendar-events";

/** The root agent's registration of the shared read-only Calendar read (ADR-0074). */
export default defineTool(calendarEventsTool());

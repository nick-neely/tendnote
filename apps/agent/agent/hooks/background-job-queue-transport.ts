import { registerBackgroundJobQueueTransport } from "@tendnote/db/queries/background-job-deliveries";
import { defineHook } from "eve/hooks";
import { createVercelBackgroundJobQueueAdapter } from "../lib/background-jobs/queue-adapter";

// Eve loads hook modules at runtime startup. Reminder mutations Eve's tools
// make (a new action with a reminder, a status change that reschedules one)
// publish their wake-up through this transport as soon as they commit, delayed
// to the alert time (ADR 0267). Unregistered, those reminders still arrive,
// through the web deployment's recovery cron.
registerBackgroundJobQueueTransport(createVercelBackgroundJobQueueAdapter());

// No event subscribers: registration is all this hook does.
export default defineHook({ events: {} });

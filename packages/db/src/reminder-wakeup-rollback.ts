/**
 * The database half of rolling back delayed reminder wake-ups (ADR 0267).
 *
 *   REMINDER_DELIVERY_PUBLISH_AHEAD=off  (deploy, so nothing publishes ahead)
 *   DATABASE_URL=... pnpm --filter @tendnote/db db:reminder-wakeups:rollback
 *   then deploy the earlier code.
 *
 * Only needed before deploying code that predates delayed wake-ups. Turning
 * the switch off alone keeps the current code delivering through the cron.
 */
import { closeDb } from "./client";
import { resetReminderDeliveriesToCronOnly } from "./queries/reminders/delivery-wakeups";

const { reset } = await resetReminderDeliveriesToCronOnly();
console.log(`reset ${reset} reminder deliveries to cron-only publication`);
await closeDb();

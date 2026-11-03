/**
 * The database half of rolling back delayed reminder wake-ups (ADR 0267).
 *
 *   1. Set REMINDER_DELIVERY_PUBLISH_AHEAD=off on web and Eve and redeploy.
 *   2. pnpm --filter @tendnote/web service-hold place <reason>
 *   3. Wait five minutes (one claim lease), then:
 *      DATABASE_URL=... pnpm --filter @tendnote/db db:reminder-wakeups:rollback
 *   4. Deploy the earlier code, then lift the hold.
 *
 * The reset refuses to run outside a hold that old, checked under a lock on
 * the hold; see `reminderRollbackBlocker`. Only needed before deploying code
 * that predates delayed wake-ups. Turning the switch off alone keeps the
 * current code delivering through the cron.
 */
import { closeDb } from "./client";
import { resetReminderDeliveriesToCronOnly } from "./queries/reminders/delivery-wakeups";

try {
  const { reset, released } = await resetReminderDeliveriesToCronOnly();
  console.log(
    `reset ${reset} reminder deliveries to cron-only publication; released ${released} expired claims`,
  );
} catch (error) {
  console.error(`Not reset: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
await closeDb();

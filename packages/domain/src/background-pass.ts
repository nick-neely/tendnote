/**
 * The shared background pass cadence: the web recovery cron
 * (`apps/web/vercel.json`) and Eve's scheduled-workflow dispatcher
 * (`apps/agent/agent/schedules/brief-dispatcher.ts`) both run on it, so an idle
 * database wakes once per pass rather than once per runtime (ADR 0266). Each
 * platform reads its cron string statically, so both stay literals; tests hold
 * them to `BACKGROUND_PASS_CRON`.
 *
 * Prelaunch policy (#764, ADR 0269): hourly, on the hour, while no paying
 * customer depends on failure-path repair latency. Ordinary work does not wait
 * for a pass: jobs publish to the queue when enqueued and reminders wake at
 * their alert time (ADR 0267). Restore the ten-minute cadence before paid
 * launch; the Hosted Obligations Register tracks it. Changing these two
 * constants and the two cron literals is the whole switch.
 */
export const BACKGROUND_PASS_CRON = "0 * * * *";

/** How long one pass waits for the next, matching `BACKGROUND_PASS_CRON`. */
export const BACKGROUND_PASS_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The interval a cron string of the two shapes this cadence uses runs at:
 * `M * * * *` (hourly) or `*\/N * * * *` (every N minutes). Anything else is
 * not a cadence this module describes, so it returns null.
 */
export function backgroundPassIntervalMs(cron: string): number | null {
  if (/^\d{1,2} \* \* \* \*$/.test(cron)) return 60 * 60 * 1000;
  const minutes = cron.match(/^\*\/(\d{1,2}) \* \* \* \*$/)?.[1];
  return minutes && 60 % Number(minutes) === 0 ? Number(minutes) * 60 * 1000 : null;
}

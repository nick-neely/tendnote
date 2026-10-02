/**
 * Whether the site may say Tendnote can restore the service.
 *
 * The recovery sentence is a promise only a passed restore drill backs, and a
 * drill goes stale six months after it passes
 * (`docs/phase-9b/backup-window-and-deletion-tail.md`). Record the date of the
 * latest passed drill here; clear it if a drill fails. Until then the sentence
 * stays off the site, while the deletion tail, which rests on configuration
 * rather than the drill, is always published.
 */
const LAST_PASSED_RESTORE_DRILL: string | null = null;

const DRILL_VALID_MONTHS = 6;

export function isRestoreDrillCurrent(
  lastPassed: string | null = LAST_PASSED_RESTORE_DRILL,
  now: Date = new Date(),
): boolean {
  if (!lastPassed) return false;
  const passed = new Date(`${lastPassed}T00:00:00Z`);
  if (Number.isNaN(passed.getTime()) || passed > now) return false;
  const expires = new Date(passed);
  expires.setUTCMonth(expires.getUTCMonth() + DRILL_VALID_MONTHS);
  return now < expires;
}

export const RECOVERY_SENTENCE =
  "Tendnote can restore the service to a point within the last seven days. Recovery is a whole-service operation, not per account, and no specific restore point is guaranteed.";

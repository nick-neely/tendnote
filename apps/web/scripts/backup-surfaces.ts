import { checkBackupSurfaces } from "@/lib/backup-surfaces";

/**
 * The backup-surface check on demand (#622), run by the operator with the
 * production project's `NEON_API_KEY` and `NEON_PROJECT_ID`:
 *
 *   pnpm --filter @tendnote/web backup-surfaces
 *
 * Prints every finding. Exits 0 with none, 1 with any, which is a Suspected
 * Incident (ADR 0250), and 2 when the check is not configured or Neon cannot be
 * read. The recovery cron runs the same check on its schedule.
 */
checkBackupSurfaces().then(
  (result) => {
    if (result.status === "off") {
      console.error("Set NEON_API_KEY and NEON_PROJECT_ID to run the backup-surface check.");
      process.exit(2);
    }
    console.log(JSON.stringify(result.findings, null, 2));
    process.exit(result.findings.length > 0 ? 1 : 0);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);

import { isRestoreStep, RESTORE_STEPS, runRestoreStep } from "@/lib/restore/procedure";
import { closeRestoreConnections, restoreDependencies } from "@/lib/restore/wiring";

/**
 * The scripted steps of a whole-service restore (#623), run by the operator
 * from `docs/operations/restore.md`, which says when to run each and with
 * which `DATABASE_URL`:
 *
 *   pnpm --filter @tendnote/web restore <step>
 *
 * Every step is safe to run again. Each prints its report and exits non-zero
 * when the report is not `ok`, which means stop and read it before going on.
 */
const [step] = process.argv.slice(2);

if (!isRestoreStep(step)) {
  console.error(`Usage: pnpm --filter @tendnote/web restore <${RESTORE_STEPS.join(" | ")}>`);
  process.exit(2);
}

// Named on every run, because `.env.local` holds production's URL and a step
// left without its `DATABASE_URL=` prefix acts on production.
console.error(`restore ${step}: database ${describeDatabase(process.env.DATABASE_URL)}`);

runRestoreStep(restoreDependencies(), step).then(
  async (report) => {
    console.log(JSON.stringify(report, null, 2));
    await closeRestoreConnections();
    process.exit(report.ok ? 0 : 1);
  },
  async (error: unknown) => {
    // A failed query's message is only the statement; its cause says why.
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof Error && error.cause) console.error(error.cause);
    await closeRestoreConnections();
    process.exit(1);
  },
);

/** The host and database a URL names, without its credentials. */
function describeDatabase(url: string | undefined): string {
  if (!url) return "(DATABASE_URL is not set: the local default)";
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return "(DATABASE_URL is not a URL)";
  }
}

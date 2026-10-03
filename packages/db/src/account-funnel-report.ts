/**
 * The saved operator funnel report, run by hand against the production
 * environment from a runbook. There is no dashboard and no analytics service:
 *
 *   pnpm --filter @tendnote/db report:funnel [days]
 *
 * It covers the accounts that signed up in the last `days` (30 by default) and
 * prints the account funnel and public activity as separate sections, with the
 * coverage gaps that make every count a floor.
 */
import { DAY_MS, renderAccountFunnelReport } from "@tendnote/domain/account-funnel";
import { closeDb } from "./client";
import { readAccountFunnelReport } from "./queries/account-telemetry";

async function main() {
  const days = Number(process.argv[2] ?? 30);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("Usage: report:funnel [days], where days is a whole number of at least 1.");
  }

  const until = new Date();
  const since = new Date(until.getTime() - days * DAY_MS);
  console.log(renderAccountFunnelReport(await readAccountFunnelReport({ since, until })));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);

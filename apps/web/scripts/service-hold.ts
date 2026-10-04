import {
  findOpenServiceWideHold,
  liftServiceWideHold,
  recordServiceWideHold,
} from "@tendnote/db/queries/service-wide-hold";
import { runServiceHoldCommand } from "@/lib/access/service-wide-hold";

/**
 * The Service-Wide Hold (#634), placed and lifted by the operator from
 * `docs/operations/service-wide-hold.md` against the production environment:
 *
 *   pnpm --filter @tendnote/web service-hold place <reason>
 *   pnpm --filter @tendnote/web service-hold lift
 *
 * Each writes its audited record and prints the outcome. Nothing else is
 * touched: the proxy, the cron, and the queue consumers read the record.
 */
runServiceHoldCommand(
  { findOpenServiceWideHold, recordServiceWideHold, liftServiceWideHold },
  process.argv.slice(2),
).then(
  (result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

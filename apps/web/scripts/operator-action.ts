import { operatorActionDependencies } from "@/lib/billing/operator-action-wiring";
import { runOperatorCommand } from "@/lib/billing/operator-actions";

/**
 * The Operator Actions there is no admin UI for (#617), run by the operator
 * from a runbook against the production environment:
 *
 *   pnpm --filter @tendnote/web operator refund <invoice id> [amount in cents]
 *   pnpm --filter @tendnote/web operator readmit-dispute <dispute id>
 *   pnpm --filter @tendnote/web operator extend-dunning <invoice id> <days>
 *   pnpm --filter @tendnote/web operator raise-ceiling <user id> <cost category> <dollars>
 *   pnpm --filter @tendnote/web operator suspend <user id> <reason>
 *   pnpm --filter @tendnote/web operator renew-suspension <user id>
 *   pnpm --filter @tendnote/web operator lift-suspension <user id>
 *   pnpm --filter @tendnote/web operator terminate <user id> <reason>
 *   pnpm --filter @tendnote/web operator legal-hold <user id> <expiry date, YYYY-MM-DD>
 *
 * Each writes and journals its record before any Stripe call and prints the
 * outcome. Extending dunning (#633), raising the Account Ceiling for the
 * current Usage Period (#633), suspending, renewing, and placing a Legal Hold
 * (#632) make no Stripe call at all. A lift and a termination then issue the
 * Suspension Credit (#631), one credit note per paid invoice the denied time
 * overlapped, and a termination first stops the renewal. Running one again
 * after a failure resumes it.
 */
runOperatorCommand(operatorActionDependencies, process.argv.slice(2)).then(
  (result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

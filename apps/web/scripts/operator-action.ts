import { operatorActionDependencies } from "@/lib/billing/operator-action-wiring";
import { runOperatorCommand } from "@/lib/billing/operator-actions";

/**
 * The Operator Actions there is no admin UI for (#617), run by the operator
 * from a runbook against the production environment:
 *
 *   pnpm --filter @tendnote/web operator refund <invoice id> [amount in cents]
 *   pnpm --filter @tendnote/web operator readmit-dispute <dispute id>
 *
 * Each writes and journals its record before any Stripe call and prints the
 * outcome. Running one again after a failure resumes it.
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

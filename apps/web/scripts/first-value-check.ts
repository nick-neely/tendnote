import { checkFirstValuePath } from "@/lib/first-value-check";

/**
 * The synthetic First Value check on demand (#649), run by the operator with
 * the production environment, including the synthetic account's credentials:
 *
 *   pnpm --filter @tendnote/web first-value-check [--grounded]
 *
 * `--grounded` also asks Eve the fixture question, one real metered turn. The
 * recovery cron runs the same check every pass and asks Eve once a day. Prints
 * the result. Exits 0 when every step passed, 1 when any failed, and 2 when the
 * check is not configured.
 */
const grounded = process.argv.includes("--grounded");

checkFirstValuePath({ claimGroundedAnswer: async () => grounded }).then(
  (result) => {
    if (result.status === "off") {
      console.error(
        "Set TENDNOTE_SYNTHETIC_CHECK_EMAIL and TENDNOTE_SYNTHETIC_CHECK_PASSWORD on a hosted deployment to run the check.",
      );
      process.exit(2);
    }
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.failed.length > 0 || result.groundedAnswer === false ? 1 : 0);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);

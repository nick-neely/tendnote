/**
 * The harness the by-hand live checks share.
 *
 * These scripts are deliberately not in the test suite - each file's header says
 * what it proves that an in-memory store cannot - so nothing else gives them a
 * runner. What they all need is the same three things: an assertion that records
 * a failure and keeps going, the two seeded accounts an owner-scoping check needs
 * to have somebody else to be, and a verdict with an exit code at the end.
 *
 * Each had grown its own copy, which `fallow dupes` reports as a clone group and
 * which is one more place to keep in step every time the shape changes. This is
 * the one copy.
 */
import { getDb } from "./client";
import { user } from "./schema/auth";

/** The two seeded accounts. Either one stands in for "somebody else" here. */
export const DEMO_OWNER = "demo-user";
export const DEMO_INTRUDER = "demo-member";

let failures = 0;

/**
 * Assert, and keep going.
 *
 * A live check is run by hand and read as a report, so stopping at the first
 * failure would hide the rest of a broken contract behind one line. The `detail`
 * is the row or result that disagreed, printed only when it did.
 */
export function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

/**
 * Stop unless the demo accounts exist, naming the command that makes them.
 *
 * A missing seed would otherwise surface as a foreign key error halfway through
 * a check that was about something else entirely.
 */
export async function requireDemoAccounts(): Promise<void> {
  const rows = await getDb().select({ id: user.id }).from(user);
  const ids = new Set(rows.map((row) => row.id));
  if (ids.has(DEMO_OWNER) && ids.has(DEMO_INTRUDER)) return;

  console.error(
    `missing ${DEMO_OWNER} / ${DEMO_INTRUDER}. Run: pnpm --filter @tendnote/db db:seed`,
  );
  process.exit(1);
}

/** The verdict and the exit code, once every check in the run has answered. */
export function reportLiveCheckResult(): never {
  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

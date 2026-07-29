import type { Page } from "@playwright/test";
import { mutationActionFor } from "@tendnote/db/instant/fixture-data";
import { recordDiagnostic } from "./support/diagnostics";
import { restoreMutationAction } from "./support/fixture-restore";
import { arriveAdmitted, expect, test } from "./support/fixtures";
import {
  formatTiming,
  measureInteraction,
  OPTIMISTIC_ACK_BUDGET_MS,
  RECONCILIATION_BUDGET_MS,
} from "./support/measure";
import { assertDestinationAccessibility } from "./support/navigate";

/**
 * The seeded Action complete-and-reopen scenario, on desktop and mobile.
 *
 * ADR 0209 makes two separate promises about a reversible lifecycle action, and
 * this spec measures them separately because conflating them is how "instant"
 * becomes "we showed something and hoped": the owner gets a deterministic local
 * projection immediately (100 ms), and the server returns authoritative state
 * shortly after (500 ms). A pass requires both — an optimistic projection that
 * never reconciles is a lie, and a correct server response that took a second to
 * acknowledge is not instant.
 *
 * Every assertion here is scoped to *this worker slot's* private Action. The
 * suite is fully parallel and this spec runs once per browser project, so a
 * shared record — or a whole-list count — would make the matrix race itself: one
 * worker's Action leaving the list while another measures a destination that
 * expects it. See the fixture's module comment for how reads and writes are
 * separated, and why the slot rather than the project is the unit.
 *
 * The scenario begins from known fixture state and returns to it through the
 * product's own authoritative Reopen command rather than by editing the
 * database, as ADR 0210 requires of every mutation scenario.
 */

async function openResolvedDisclosure(page: Page) {
  // Resolved rows live on their own shelf, loaded on demand — itself the
  // interaction-started contract from #309. The shelf stays open through that
  // fetch, so opening it is one click on the section that names itself.
  await page.getByRole("button", { name: "Resolved", exact: true }).click();
}

test.describe("@promotion-smoke Action complete and reopen", () => {
  /**
   * Hand the next test a clean fixture however this one ended.
   *
   * The scenario below restores its own Action through the product's Reopen
   * command, which is what ADR 0210 asks for — but only if it gets that far, and
   * a budget breach in the *complete* half aborts before the reopen. See
   * `support/fixture-restore.ts` for what one such abort did to the next browser
   * project, and why putting the row back is only half of putting it back.
   *
   * After every test rather than only after a failure: a teardown that only runs
   * on the path nobody exercises is a teardown nobody knows is broken. On the
   * happy path it is a write against a row already in seeded state, followed by
   * a reconciliation of caches that are already correct.
   */
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the first parameter's destructuring pattern to decide which fixtures a hook depends on, and an empty pattern is how a hook says "none". This teardown talks to Postgres and the server directly; a named parameter would ask for a browser page it never uses.
  test.afterEach(async ({}, testInfo) => {
    await restoreMutationAction(mutationActionFor(testInfo.parallelIndex).id);
  });

  test("acknowledges optimistically and reconciles authoritatively", async ({ page }, testInfo) => {
    const action = mutationActionFor(testInfo.parallelIndex);
    const actionRow = `article[id='action-${action.id}']`;

    await arriveAdmitted(page, "/actions");
    await expect(page.locator(actionRow)).toBeVisible();

    const completion = await measureInteraction(page, {
      toUrl: null,
      // ADR 0209's deterministic local projection: the row leaves immediately.
      shell: [{ selector: `${actionRow}[data-leaving='true']` }],
      // The authoritative result, with its inverse offered rather than a
      // cosmetic undo.
      authoritative: [{ selector: "[role='status']", text: "Completed" }],
      click: () =>
        page.locator(actionRow).getByRole("button", { name: "Complete", exact: true }).click(),
    });

    recordMutation(testInfo.project.name, "Action complete", completion);

    expect(
      completion.shell,
      `Action complete — ${formatTiming(completion)}: optimistic acknowledgement`,
    ).toBeLessThanOrEqual(OPTIMISTIC_ACK_BUDGET_MS);
    expect(
      completion.complete,
      `Action complete — ${formatTiming(completion)}: authoritative reconciliation`,
    ).toBeLessThanOrEqual(RECONCILIATION_BUDGET_MS);

    await assertDestinationAccessibility(page, "Action complete");

    // Read-your-writes: a fresh authoritative render must agree with the
    // acknowledged mutation rather than resurrecting the completed row.
    await page.reload();
    await expect(page.locator("[data-admitted]")).toBeAttached();
    await expect(page.locator(actionRow)).toHaveCount(0);

    await openResolvedDisclosure(page);
    const reopenControl = page.locator(`${actionRow} [data-action-control='reopen']`);
    await expect(reopenControl).toBeVisible();

    const reopen = await measureInteraction(page, {
      toUrl: null,
      shell: [{ selector: "[role='status']", text: "Reopening" }],
      authoritative: [{ selector: "[role='status']", text: "Reopened" }],
      click: () => reopenControl.click(),
    });

    recordMutation(testInfo.project.name, "Action reopen", reopen);

    expect(
      reopen.shell,
      `Action reopen — ${formatTiming(reopen)}: optimistic acknowledgement`,
    ).toBeLessThanOrEqual(OPTIMISTIC_ACK_BUDGET_MS);
    expect(
      reopen.complete,
      `Action reopen — ${formatTiming(reopen)}: authoritative reconciliation`,
    ).toBeLessThanOrEqual(RECONCILIATION_BUDGET_MS);

    // The fixture is restored, and it is restored by the server rather than by
    // the client's projection: reload before believing it.
    //
    // One retrying assertion, not a count followed by a visibility check. For
    // roughly 150–200 ms after this reload the reopened row renders *twice* —
    // once in the active ledger and once in the not-yet revalidated Resolved
    // projection behind its closed disclosure — before settling to one. Two
    // separate assertions leave a gap the second one can land in; "exactly one
    // visible row" is the settled invariant and retries until it holds, while
    // still failing if the duplicate ever becomes permanent. Recorded as a
    // finding in docs/verification/nextjs-16-3-instant-navigation.md.
    await page.reload();
    await expect(page.locator("[data-admitted]")).toBeAttached();
    await expect(page.locator(actionRow).filter({ visible: true })).toHaveCount(1);
  });
});

function recordMutation(
  project: string,
  scenario: string,
  timing: {
    shell: number;
    complete: number;
    stable: number;
    cumulativeLayoutShift: number;
    frameIntervalMs: number;
  },
) {
  recordDiagnostic({
    scenario,
    project,
    temperature: "warm",
    acknowledgementMs: null,
    shellMs: timing.shell,
    completeMs: timing.complete,
    stableMs: timing.stable,
    cumulativeLayoutShift: timing.cumulativeLayoutShift,
    // Both halves of ADR 0209's promise are gated here, so both budgets travel
    // with the record and the summariser can report either margin.
    shellBudgetMs: OPTIMISTIC_ACK_BUDGET_MS,
    completeBudgetMs: RECONCILIATION_BUDGET_MS,
    frameIntervalMs: timing.frameIntervalMs,
    rscResponses: 0,
    rscBytes: 0,
    requestFanOut: 0,
  });
}

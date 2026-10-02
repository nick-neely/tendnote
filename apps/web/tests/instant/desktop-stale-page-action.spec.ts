import { mutationActionFor } from "@tendnote/db/instant/fixture-data";
import { cacheProfiles } from "../../src/lib/cache/cache-profiles";
import { restoreMutationAction } from "./support/fixture-restore";
import { arriveAdmitted, expect, test } from "./support/fixtures";

/**
 * A Server Action against a page whose prerendered entry has gone stale (#676).
 *
 * `/actions` uses the `interactive` profile, so its prerendered entry is stale
 * `revalidate` seconds after it was generated. Next 16.3.3 answers a Server
 * Action that lands in that state by scheduling a background revalidation that
 * renders with the same live request — which runs the action a second time, on
 * a body the first run already consumed. The empty decode throws, and the owner
 * gets a 500 for a write that committed. `patches/next@16.3.3.patch` stops an
 * action request from scheduling that revalidation.
 *
 * The rest of the matrix only met this by chance, whenever a scenario's action
 * happened to land after the window, which is why it read as a flake on
 * whichever spec was running. Here the window is waited out on purpose.
 *
 * Desktop only and outside the promotion tier: the defect is in the server's
 * cache path, not the browser, and the wait is the cost of making it
 * deterministic, so it is paid once per run.
 *
 * It can only fail on one worker, as CI runs. With parallel local workers,
 * another spec may render `/actions` during the wait and refresh the entry,
 * and the action then lands on a fresh one. The cache-status header cannot
 * prove the precondition either, because an action response reads `HIT` even
 * when the entry is stale.
 */

/** Past the revalidate window, with headroom for the arrival's own render. */
const STALE_AFTER_MS = (cacheProfiles.interactive.revalidate + 3) * 1000;

test.describe("Server Action on a stale prerendered page", () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the first parameter's destructuring pattern to decide which fixtures a hook depends on, and an empty pattern is how a hook says "none". This teardown talks to Postgres and the server directly; a named parameter would ask for a browser page it never uses.
  test.afterEach(async ({}, testInfo) => {
    await restoreMutationAction(mutationActionFor(testInfo.parallelIndex).id);
  });

  test("Action complete succeeds once the page entry is stale", async ({ page }, testInfo) => {
    test.setTimeout(STALE_AFTER_MS + 60_000);
    const action = mutationActionFor(testInfo.parallelIndex);
    const actionRow = `article[id='action-${action.id}']`;

    await arriveAdmitted(page, "/actions");
    await expect(page.locator(actionRow)).toBeVisible();

    // Nothing may request the page in the meantime: any render would refresh
    // the entry and the action would land on a fresh one.
    await page.waitForTimeout(STALE_AFTER_MS);

    const actionStatuses: number[] = [];
    page.on("response", (response) => {
      const request = response.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        actionStatuses.push(response.status());
      }
    });

    await page.locator(actionRow).getByRole("button", { name: "Complete", exact: true }).click();
    await expect(page.locator("[role='status']", { hasText: "Completed" })).toBeVisible();

    expect(actionStatuses, "the Complete action was sent").not.toHaveLength(0);
    expect(
      actionStatuses.filter((status) => status !== 200),
      "every Server Action against the stale page succeeded",
    ).toEqual([]);
  });
});

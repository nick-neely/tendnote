import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  ISOLATION_OWNER,
  ISOLATION_PERSON,
  NAVIGATION_ACTION,
  PRIMARY_PERSON,
} from "@tendnote/db/instant/fixture-data";
import { arriveAdmitted, expect, test, watchRuntimeErrors } from "./support/fixtures";
import { storageStatePath } from "./support/rig";

/**
 * Cache isolation between two admitted owners.
 *
 * Cache Components is the reason this spec exists. Every owner-scoped read is
 * now backed by a cache entry, so "fast" and "wrong" have become adjacent
 * failures in a way they were not before: an entry keyed on anything less than
 * verified identity would make the second owner's page faster *and* someone
 * else's. ADR 0210 therefore requires a second synthetic owner rather than a
 * reasoned argument, and the order below is deliberate — the primary owner
 * always reads first, so every assertion the isolation owner makes runs against
 * an already-warm cache.
 */

const MISSING_PERSON_ID = "00000000-0000-4000-8000-0000000000ff";

async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

/**
 * Read a destination only once it has finished resolving.
 *
 * Comparing two pages mid-stream compares how far each got, not what each says:
 * one snapshot can hold the access check while the other already holds the
 * reserve. Both must be settled before "indistinguishable" means anything.
 */
/**
 * The isolation owner's own context.
 *
 * Opened by hand rather than through the shared fixture because it needs a
 * different storage state, so its runtime-error watch has to be attached
 * explicitly — a context the harness created but did not watch would be the one
 * place a hydration failure could pass unnoticed.
 */
async function openIsolationContext(browser: Browser): Promise<{
  context: BrowserContext;
  page: Page;
  errors: string[];
}> {
  const context = await browser.newContext({
    storageState: storageStatePath(ISOLATION_OWNER.userId),
  });
  const errors = watchRuntimeErrors(context);
  return { context, page: await context.newPage(), errors };
}

async function settledText(page: Page, path: string): Promise<string> {
  await arriveAdmitted(page, path);
  await expect(page.locator("[aria-busy='true']").filter({ visible: true })).toHaveCount(0);
  return bodyText(page);
}

test.describe("owner isolation", () => {
  test("@promotion-smoke a warm cache never crosses owners", async ({ browser, page }) => {
    // Primary owner first: this is what fills the cache.
    await arriveAdmitted(page, "/people");
    await expect(
      page.getByRole("link", { name: new RegExp(PRIMARY_PERSON.displayName) }),
    ).toBeVisible();
    expect(await bodyText(page)).not.toContain(ISOLATION_PERSON.displayName);

    const isolation = await openIsolationContext(browser);
    const other = isolation.page;

    try {
      await arriveAdmitted(other, "/people");

      await expect(
        other.getByRole("link", { name: new RegExp(ISOLATION_PERSON.displayName) }),
      ).toBeVisible();
      expect(
        await bodyText(other),
        "the isolation owner must not receive the primary owner's cached People view",
      ).not.toContain(PRIMARY_PERSON.displayName);

      // Today and Actions read from their own cached projections, so each one is
      // a separate opportunity to leak.
      for (const path of ["/", "/actions"]) {
        await arriveAdmitted(other, path);
        expect(await bodyText(other), `${path} must stay owner-scoped`).not.toContain(
          NAVIGATION_ACTION.title,
        );
      }

      expect(isolation.errors, "the isolation owner's context stayed error-free").toEqual([]);
    } finally {
      await isolation.context.close();
    }
  });

  test("an unauthorized record is indistinguishable from a missing one", async ({ browser }) => {
    const isolation = await openIsolationContext(browser);
    const other = isolation.page;

    try {
      // The primary owner's person exists; this one does not. If the two
      // responses differed at all — status, copy, or timing shape — the absence
      // of a record would be inferable, which is the leak ADR 0206 forbids.
      const unauthorized = await settledText(other, `/people/${PRIMARY_PERSON.id}`);
      const missing = await settledText(other, `/people/${MISSING_PERSON_ID}`);

      expect(unauthorized).not.toContain(PRIMARY_PERSON.displayName);
      expect(unauthorized).toEqual(missing);
      expect(isolation.errors, "the isolation owner's context stayed error-free").toEqual([]);
    } finally {
      await isolation.context.close();
    }
  });
});

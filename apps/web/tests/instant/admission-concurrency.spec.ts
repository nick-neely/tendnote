import { expect, settleSourceSurface, test } from "./support/fixtures";

/**
 * A hard load may show the owner-neutral access check only until request-bound admission
 * resolves. These cases are intentionally independent Playwright tests: local workers run
 * them concurrently as separate browser clients against one production server, which is
 * the load shape that exposed #334.
 */
for (const path of ["/", "/people", "/actions"]) {
  test(`reveals admitted navigation after a concurrent hard load of ${path}`, async ({ page }) => {
    await page.goto(path);

    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Checking access…")).toBeHidden();
    await settleSourceSurface(page);
  });
}

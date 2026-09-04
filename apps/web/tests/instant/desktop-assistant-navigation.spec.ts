import { instant } from "@next/playwright";
import { arriveAdmitted, expect, settleSourceSurface, test } from "./support/fixtures";

import { instantBaseUrl } from "./support/rig";

for (const width of [1440, 390]) {
  test(`Assistant opening is available before owner data at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addCookies([{ name: "sidebar_state", value: "false", url: instantBaseUrl() }]);
    await arriveAdmitted(page, "/");
    if (width < 768) {
      await page.getByRole("button", { name: "Menu", exact: true }).click();
    }
    await settleSourceSurface(page);
    const assistantLink = page
      .getByRole("link", { name: "Assistant", exact: true })
      .filter({ visible: true })
      .first();
    await instant(page, async () => {
      await assistantLink.click();
      await expect(page.getByRole("heading", { name: "Assistant", exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "What do you want to remember?" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Who should I reach out to this week?" }),
      ).toBeVisible();
      await expect(page.getByRole("region", { name: "Loading composer" })).toBeVisible();
      if (width > 768) {
        await expect(
          page
            .getByRole("navigation", { name: "Conversations" })
            .locator("xpath=ancestor::*[@data-state][1]"),
        ).toHaveAttribute("data-state", "collapsed");
      }
    });
    await expect(page.getByRole("textbox")).toBeVisible();
    if (width > 768) {
      await expect(
        page
          .getByRole("navigation", { name: "Conversations" })
          .locator("xpath=ancestor::*[@data-state][1]"),
      ).toHaveAttribute("data-state", "collapsed");
    }
  });
}

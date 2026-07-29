import type { Page } from "@playwright/test";
import { ACTIONS, MOBILE_REVIEW, MOBILE_TODAY } from "./support/destinations";
import { arriveAdmitted, expect, test } from "./support/fixtures";
import { runNavigationRow } from "./support/navigate";
import { openPeople, peopleToPersonDetailRow, personLinkName } from "./support/rows";

/**
 * The mobile half of ADR 0210's routine Chromium matrix: Today to Review,
 * Menu to Actions, and People to person detail.
 *
 * Today to Review appears here and not in the desktop spec on purpose. Home is
 * one destination with rail tabs, and on desktop `?tab=review` is a client-side
 * tab selection written to the URL with `history.replaceState` — no navigation
 * and no request, so there is nothing for `instant()` to assert. On mobile the
 * bottom bar's Review entry is a real `<Link>` to a genuinely different
 * composition, which is the transition this row is about.
 *
 * Nothing here carries `@promotion-smoke`. ADR 0210's reduced Firefox and WebKit
 * tier is a desktop one — both promotion projects use desktop device profiles
 * and `testIgnore` this file — so a tag here would select nothing and read as
 * cross-engine mobile coverage that does not exist.
 */

function bottomBar(page: Page) {
  return page.getByRole("navigation", { name: "Mobile primary" });
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Menu destinations" })).toBeVisible();
}

test.describe("mobile critical navigation", () => {
  test("Today to Review", async ({ page, network }, testInfo) => {
    await arriveAdmitted(page, "/");

    await runNavigationRow({
      page,
      testInfo,
      network,
      scenario: "mobile Today to Review",
      destination: MOBILE_REVIEW,
      arrive: (target) => arriveAdmitted(target, "/"),
      click: (target) => bottomBar(target).getByRole("link", { name: "Review" }).click(),
      returnToSource: (target) => bottomBar(target).getByRole("link", { name: "Today" }).click(),
    });
  });

  test("Menu to Actions", async ({ page, network }, testInfo) => {
    await arriveAdmitted(page, "/");
    await openMenu(page);

    await runNavigationRow({
      page,
      testInfo,
      network,
      scenario: "mobile Menu to Actions",
      destination: ACTIONS,
      arrive: async (target) => {
        await arriveAdmitted(target, "/");
        await openMenu(target);
      },
      click: (target) =>
        target
          .getByRole("navigation", { name: "Menu destinations" })
          .getByRole("link", { name: "Actions" })
          .click(),
      returnToSource: async (target) => {
        // Choosing a destination closes the Menu: it covers the page it is
        // navigating to, so leaving it up would read as a frozen app. The row's
        // source is therefore Home with the Menu re-opened, reached through the
        // bar the flow is no longer hiding.
        await bottomBar(target).getByRole("link", { name: "Today" }).click();
        await openMenu(target);
      },
    });
  });

  test("People to person detail", async ({ page, network }, testInfo) => {
    await openPeople(page);

    await peopleToPersonDetailRow({
      page,
      testInfo,
      network,
      scenario: "mobile People to person detail",
      returnToSource: async (target) => {
        await target.goBack();
        await expect(target.getByRole("link", { name: personLinkName })).toBeVisible();
      },
    });
  });

  test("Today is the mobile destination", async ({ page, network }, testInfo) => {
    await arriveAdmitted(page, "/people");

    await runNavigationRow({
      page,
      testInfo,
      network,
      scenario: "mobile People to Today",
      destination: MOBILE_TODAY,
      arrive: (target) => arriveAdmitted(target, "/people"),
      click: (target) => bottomBar(target).getByRole("link", { name: "Today" }).click(),
      returnToSource: async (target) => {
        await target.goto("/people");
        await expect(target.getByRole("link", { name: personLinkName })).toBeVisible();
      },
    });
  });
});

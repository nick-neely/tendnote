import type { Page } from "@playwright/test";
import { PRIMARY_PERSON } from "@tendnote/db/instant/fixture-data";
import { DESKTOP_HOME, PEOPLE } from "./support/destinations";
import { arriveAdmitted, expect, test } from "./support/fixtures";
import { runNavigationRow } from "./support/navigate";
import { openPeople, peopleToPersonDetailRow, personLinkName } from "./support/rows";

/**
 * The desktop half of ADR 0210's routine Chromium matrix: Today to People,
 * People to person detail, and person detail back to Today.
 *
 * Every row is driven with a real `<Link>` click rather than `page.goto`,
 * because the static shell only pays off on soft navigation — see
 * `arriveAdmitted` for why a hard load measures the access check instead.
 */

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

async function openPersonDetail(page: Page) {
  // Wait for the People list to be the surface on screen before reaching for the
  // row. Home names this person too — its rail links them from the review card —
  // so a locator evaluated during the swap can resolve against the surface being
  // left and then wait forever for a link the owner is no longer looking at.
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await page.getByRole("link", { name: personLinkName }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: PRIMARY_PERSON.displayName }),
  ).toBeVisible();
}

test.describe("desktop critical navigation", () => {
  test("@promotion-smoke Today to People", async ({ page, network }, testInfo) => {
    await arriveAdmitted(page, "/");

    await runNavigationRow({
      page,
      testInfo,
      network,
      scenario: "desktop Today to People",
      destination: PEOPLE,
      arrive: (target) => arriveAdmitted(target, "/"),
      click: (target) => primaryNav(target).getByText("People").click(),
      returnToSource: (target) => primaryNav(target).getByText("Today").click(),
    });
  });

  test("@promotion-smoke People to person detail", async ({ page, network }, testInfo) => {
    await openPeople(page);

    await peopleToPersonDetailRow({
      page,
      testInfo,
      network,
      scenario: "desktop People to person detail",
      returnToSource: (target) => primaryNav(target).getByText("People").click(),
    });
  });

  test("@promotion-smoke person detail to Today", async ({ page, network }, testInfo) => {
    await arriveAdmitted(page, `/people/${PRIMARY_PERSON.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: PRIMARY_PERSON.displayName }),
    ).toBeVisible();

    await runNavigationRow({
      page,
      testInfo,
      network,
      scenario: "desktop person detail to Today",
      destination: DESKTOP_HOME,
      arrive: async (target) => {
        await arriveAdmitted(target, `/people/${PRIMARY_PERSON.id}`);
        await expect(
          target.getByRole("heading", { level: 1, name: PRIMARY_PERSON.displayName }),
        ).toBeVisible();
      },
      click: (target) => primaryNav(target).getByText("Today").click(),
      returnToSource: async (target) => {
        await primaryNav(target).getByText("People").click();
        await openPersonDetail(target);
      },
    });
  });
});

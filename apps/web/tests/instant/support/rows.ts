import type { Page, TestInfo } from "@playwright/test";
import { PRIMARY_PERSON } from "@tendnote/db/instant/fixture-data";
import { PERSON_DETAIL } from "./destinations";
import { arriveAdmitted, expect, type NetworkWindow } from "./fixtures";
import { runNavigationRow } from "./navigate";

/**
 * Matrix rows that both viewports drive.
 *
 * People to person detail is in ADR 0210's matrix twice — once on desktop and
 * once on mobile — and the two differ only in how the owner gets back to the
 * list. Keeping one definition means a change to what the row proves cannot
 * apply to one viewport and not the other.
 */

export const personLinkName = new RegExp(PRIMARY_PERSON.displayName);

export async function openPeople(page: Page) {
  await arriveAdmitted(page, "/people");
  await expect(page.getByRole("link", { name: personLinkName })).toBeVisible();
}

export function peopleToPersonDetailRow(options: {
  page: Page;
  testInfo: TestInfo;
  network: NetworkWindow;
  scenario: string;
  /** How this viewport returns to the People list. */
  returnToSource: (page: Page) => Promise<void>;
}) {
  return runNavigationRow({
    page: options.page,
    testInfo: options.testInfo,
    network: options.network,
    scenario: options.scenario,
    destination: PERSON_DETAIL,
    arrive: openPeople,
    click: (target) => target.getByRole("link", { name: personLinkName }).click(),
    returnToSource: options.returnToSource,
  });
}

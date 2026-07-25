import type { Page } from "@playwright/test";
import { PRIMARY_PERSON } from "@tendnote/db/instant/fixture-data";
import { recordDiagnostic } from "./support/diagnostics";
import { arriveAdmitted, test } from "./support/fixtures";

/**
 * Cold direct-load payload diagnostics for the three routes ADR 0210 says must
 * not grow: Today, Review, and person detail.
 *
 * Recorded, not gated. The upgrade criterion is "cold JavaScript does not grow"
 * against the 16.2 baseline, and a threshold derived from a single machine's
 * first distribution would fail on chunk-splitting noise long before it caught a
 * real regression. The numbers land in the run's diagnostics and are reviewed in
 * `docs/verification/nextjs-16-3-instant-navigation.md` against the baseline's
 * own `transferSize` figures, which is the same measurement taken the same way.
 */

const COLD_ROUTES = [
  { scenario: "cold load: Today", path: "/" },
  { scenario: "cold load: Review", path: "/?tab=review" },
  { scenario: "cold load: person detail", path: `/people/${PRIMARY_PERSON.id}` },
];

async function scriptTransferBytes(page: Page): Promise<number> {
  return page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "script")
      .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0),
  );
}

test.describe("payload diagnostics", () => {
  for (const route of COLD_ROUTES) {
    test(route.scenario, async ({ page, network }, testInfo) => {
      network.reset();
      await arriveAdmitted(page, route.path);

      recordDiagnostic({
        scenario: route.scenario,
        project: testInfo.project.name,
        temperature: "cold",
        acknowledgementMs: null,
        shellMs: 0,
        completeMs: 0,
        stableMs: 0,
        cumulativeLayoutShift: 0,
        rscResponses: network.rscResponses(),
        rscBytes: network.rscBytes(),
        scriptBytes: await scriptTransferBytes(page),
        requestFanOut: network.requests(),
      });
    });
  }
});

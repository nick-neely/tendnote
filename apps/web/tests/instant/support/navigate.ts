import { instant } from "@next/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import type { DestinationContract } from "./destinations";
import { recordDiagnostic } from "./diagnostics";
import {
  awaitDestinationPrefetch,
  type NetworkWindow,
  settleSourceSurface,
  watchNetwork,
} from "./fixtures";
import type { MarkerSpec } from "./instrumentation";
import {
  formatSamples,
  formatTiming,
  LAYOUT_SHIFT_BUDGET,
  measureInteraction,
  SAMPLE_CEILING_MULTIPLE,
  type SampleSummary,
  SHELL_BUDGET_MS,
  summariseSamples,
} from "./measure";

export type NavigationRow = {
  page: Page;
  testInfo: TestInfo;
  network: NetworkWindow;
  scenario: string;
  destination: DestinationContract;
  /** Arrive at the source surface, admitted. Used again for the cold-cache pass. */
  arrive: (page: Page) => Promise<void>;
  /** Perform the owner's click on the given page. */
  click: (page: Page) => Promise<void>;
  /** Return to the source surface between measured passes. */
  returnToSource: (page: Page) => Promise<void>;
};

/**
 * One row of the critical navigation matrix, driven three times.
 *
 * Three passes, because one navigation cannot honestly answer all three
 * questions:
 *
 * 1. **cold** — the first transition to this destination in the context,
 *    measured with the lock off. What the owner experiences on arrival.
 * 2. **warm** — the repeat transition. ADR 0210 requires cold and warm to be
 *    separated so cache wins are not read as first-load wins.
 * 3. **contract** — the same transition inside `instant()`, on a *new page*.
 *    The page is new because `instant()` serves whatever the client router has
 *    already cached: on a page that has visited the destination twice, streamed
 *    owner data legitimately appears inside the callback, and the `deferred`
 *    assertion — the one that proves the lock is engaged — would be asserting
 *    the opposite of the truth. A fresh page has a cold router cache, which is
 *    the only state in which "this data has not arrived yet" is meaningful.
 */
export async function runNavigationRow(row: NavigationRow) {
  const { page, testInfo, network, scenario, destination, arrive, click, returnToSource } = row;

  const acknowledgements: number[] = [];
  const shells: number[] = [];

  // One cold sample, then three warm ones: ADR 0210 compares against baseline
  // *medians*, and a single warm reading on a contended runner is not a median.
  for (const temperature of ["cold", "warm", "warm", "warm"] as const) {
    // The row measures the navigation, not the scheduling of its prefetch.
    await awaitDestinationPrefetch(page, network, destination.url);
    network.reset();

    const timing = await measureInteraction(page, {
      toUrl: destination.url,
      shell: destination.shell,
      authoritative: destination.authoritative,
      click: () => click(page),
    });

    recordDiagnostic({
      scenario,
      project: testInfo.project.name,
      temperature,
      acknowledgementMs: timing.acknowledgement,
      shellMs: timing.shell,
      completeMs: timing.complete,
      stableMs: timing.stable,
      cumulativeLayoutShift: timing.cumulativeLayoutShift,
      shellBudgetMs: SHELL_BUDGET_MS,
      frameIntervalMs: timing.frameIntervalMs,
      rscResponses: network.rscResponses(),
      rscBytes: network.rscBytes(),
      requestFanOut: network.requests(),
    });

    const context = `${scenario} (${temperature}) — ${formatTiming(timing)}`;

    // Correctness, per sample: a transition that never moved the URL is not a
    // slow acknowledgement, it is an absent one, and no median can excuse it.
    expect(timing.acknowledgement, `${context}: navigation acknowledged`).not.toBeNull();
    // Layout stability is likewise per sample. It is not a clock reading and
    // does not degrade with the runner: every recorded row is 0.0000, so a
    // single shift is a real one.
    expect(
      timing.cumulativeLayoutShift,
      `${context}: layout stability through completion`,
    ).toBeLessThanOrEqual(LAYOUT_SHIFT_BUDGET);

    acknowledgements.push(timing.acknowledgement ?? Number.POSITIVE_INFINITY);
    shells.push(timing.shell);

    await expectMarkers(
      page,
      destination.authoritative,
      `${scenario} (${temperature}): authoritative content`,
    );
    await assertDestinationAccessibility(page, `${scenario} (${temperature})`);
    await returnToSource(page);
    await settleSourceSurface(page);
  }

  expectWithinContract(scenario, "acknowledgement", summariseSamples(acknowledgements));
  expectWithinContract(scenario, "truthful shell", summariseSamples(shells));

  const cold = await page.context().newPage();
  const coldNetwork = watchNetwork(cold);

  try {
    await arrive(cold);

    const sourceUrl = new URL(cold.url()).pathname + new URL(cold.url()).search;

    await instant(cold, async () => {
      await click(cold);

      if (destination.instantContract === "dynamic-response") {
        // Pinned deliberately. This destination has no reusable shell in the
        // prefetch cache, so with only cached content available the router has
        // nothing to commit and the URL does not move. If that ever changes —
        // in either direction — this fails and the contract gets re-read rather
        // than silently drifting.
        await expect(
          cold,
          `${scenario}: has no reusable shell, so it cannot commit from cache`,
        ).toHaveURL(new RegExp(`${escapeForRegExp(sourceUrl)}$`));
        return;
      }

      await expectMarkers(cold, destination.shell, `${scenario}: truthful shell inside instant()`);
      if (destination.deferred) {
        await expectMarkers(
          cold,
          destination.deferred,
          `${scenario}: owner data is deferred, so instant() is genuinely engaged`,
        );
      }
    });

    await expectMarkers(
      cold,
      destination.authoritative,
      `${scenario}: authoritative content after instant()`,
    );

    recordDiagnostic({
      scenario: `${scenario} (instant contract)`,
      project: testInfo.project.name,
      temperature: "cold",
      acknowledgementMs: null,
      shellMs: 0,
      completeMs: 0,
      stableMs: 0,
      cumulativeLayoutShift: 0,
      rscResponses: coldNetwork.rscResponses(),
      rscBytes: coldNetwork.rscBytes(),
      scriptBytes: coldNetwork.scriptBytes(),
      requestFanOut: coldNetwork.requests(),
    });
  } finally {
    await cold.close();
  }
}

/**
 * Hold one measured stage of a row to the 100 ms contract.
 *
 * Two assertions rather than one, and neither of them moves the budget:
 *
 * - the row's **median** must be inside `SHELL_BUDGET_MS`, which is the statistic
 *   ADR 0210 reasons in and the reason the row takes four samples at all;
 * - **every** sample must be inside the outlier ceiling, so a row cannot hide a
 *   genuinely broken transition behind three good ones.
 *
 * See `SAMPLE_CEILING_MULTIPLE` in `measure.ts` for the measurements this
 * answers (#331): the acknowledgement is quantised to the browser's frame
 * cadence, so on a two-vCPU runner one dropped frame is the whole difference
 * between 99 ms and 104 ms, and the row that failed there is indistinguishable
 * from its neighbours on any machine quiet enough to measure honestly.
 */
function expectWithinContract(scenario: string, stage: string, summary: SampleSummary) {
  const ceiling = SHELL_BUDGET_MS * SAMPLE_CEILING_MULTIPLE;

  expect(
    summary.median,
    `${scenario}: ${stage} within the contract — ${formatSamples(summary)}`,
  ).toBeLessThanOrEqual(SHELL_BUDGET_MS);
  expect(
    summary.max,
    `${scenario}: no ${stage} sample past ${ceiling}ms — ${formatSamples(summary)}`,
  ).toBeLessThanOrEqual(ceiling);
}

/** Assert a set of marker specs, using the same visibility rule as the recorder. */
export async function expectMarkers(page: Page, markers: MarkerSpec[], message: string) {
  for (const marker of markers) {
    const locator = locatorFor(page, marker);

    if (marker.absent) {
      // Visible only, matching the in-page recorder's rule. A region that is in
      // the DOM but `display: none` — the desktop assistant column on a phone
      // viewport, for instance — is not something the owner is waiting on, and
      // counting it would make "no reserve remains" impossible to satisfy.
      await expect(
        locator.filter({ visible: true }),
        `${message} — ${describe(marker)}`,
      ).toHaveCount(0);
    } else {
      await expect(locator.first(), `${message} — ${describe(marker)}`).toBeVisible();
    }
  }
}

function locatorFor(page: Page, marker: MarkerSpec) {
  if (marker.text) return page.locator(marker.selector, { hasText: marker.text });
  if (marker.anyText) {
    return page.locator(marker.selector, {
      hasText: new RegExp(marker.anyText.map(escapeForRegExp).join("|")),
    });
  }
  return page.locator(marker.selector);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function describe(marker: MarkerSpec): string {
  const text = marker.text
    ? ` containing ${JSON.stringify(marker.text)}`
    : marker.anyText
      ? ` containing one of ${JSON.stringify(marker.anyText)}`
      : "";
  return `${marker.absent ? "no visible " : ""}${marker.selector}${text}`;
}

/**
 * The accessibility properties ADR 0207 and ADR 0209 actually promise, checked
 * on the settled destination.
 *
 * Deliberately not a generic rule sweep: a general-purpose auditor would report
 * the design system's standing findings on every row and teach the suite to be
 * ignored. These are the claims the instant-navigation contract itself makes,
 * and therefore the ones it can break.
 */
export async function assertDestinationAccessibility(page: Page, scenario: string) {
  const report = await page.evaluate(() => {
    const visible = (element: Element) =>
      (element as HTMLElement).getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden";
    const unnamed = (element: Element) =>
      !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby");

    const mains = Array.from(document.querySelectorAll("main")).filter(visible);
    const headings = Array.from(document.querySelectorAll("h1")).filter(visible);
    const busy = Array.from(document.querySelectorAll("[aria-busy='true']")).filter(visible);
    // ADR 0209's rule is that pending state uses "visible text and `aria-busy`,
    // not a spinner alone". A Shaped Reserve satisfies it with an accessible
    // name; a pending row satisfies it with its own copy ("Updating action…").
    // Requiring a name from both would fail a row that is announcing correctly.
    const announced = (element: Element) =>
      !unnamed(element) || (element.textContent ?? "").trim().length > 0;
    const navs = Array.from(document.querySelectorAll("nav")).filter(visible);
    const active = document.activeElement;

    // What Playwright's own actionability check tests, asserted as a contract
    // rather than discovered as a 60-second click timeout: the topmost element
    // at a navigation link's own centre must be that link. A `fixed` overlay
    // that lands on the primary navigation makes the destination unreachable
    // while looking perfectly rendered, which is how the PWA update notice sat
    // on the desktop header until Firefox failed on it.
    const describeObstruction = (element: Element) => {
      const classes = String(element.getAttribute("class") ?? "")
        .split(" ")
        .filter(Boolean);
      return `<${element.tagName.toLowerCase()} class="${classes.slice(0, 4).join(" ")}">`;
    };

    let navigationObstructedBy: string | null = null;
    for (const nav of navs) {
      const link = Array.from(nav.querySelectorAll("a")).filter(visible)[0];
      if (!link) continue;

      const box = link.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      // A link scrolled out of the viewport has no meaningful hit test, and
      // asserting one would fail on geometry rather than on obstruction.
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;

      const topmost = document.elementFromPoint(x, y);
      if (topmost && topmost !== link && !link.contains(topmost)) {
        navigationObstructedBy = `${nav.getAttribute("aria-label") ?? "nav"} — ${describeObstruction(topmost)}`;
        break;
      }
    }

    return {
      mains: mains.length,
      headings: headings.length,
      unannouncedBusyRegions: busy.filter((region) => !announced(region)).length,
      unnamedNavs: navs.filter(unnamed).length,
      focusDetached: active !== null && !active.isConnected,
      navigationObstructedBy,
    };
  });

  expect(report.mains, `${scenario}: exactly one route main landmark`).toBe(1);
  expect(report.headings, `${scenario}: at most one visible level-one heading`).toBeLessThanOrEqual(
    1,
  );
  expect(report.unannouncedBusyRegions, `${scenario}: every pending region is announced`).toBe(0);
  expect(report.unnamedNavs, `${scenario}: every navigation landmark is named`).toBe(0);
  expect(report.focusDetached, `${scenario}: focus survived the transition`).toBe(false);
  expect(
    report.navigationObstructedBy,
    `${scenario}: nothing is covering the owner's navigation`,
  ).toBeNull();
}

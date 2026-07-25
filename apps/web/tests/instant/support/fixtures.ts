import type { BrowserContext, Page, Response } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { INSTRUMENTATION_KEY, instrumentationScript } from "./instrumentation";

/**
 * The shared fixture for every Instant matrix spec.
 *
 * Three things every scenario needs, so none of them can be forgotten in one:
 *
 * 1. The measurement recorder is installed before any application code runs.
 * 2. Runtime failures are collected and asserted empty at teardown. A hydration
 *    mismatch or a failed module load reaches the console without failing an
 *    assertion, so a suite that does not watch for it can report a green instant
 *    navigation on a page that never became interactive — which ADR 0211 names
 *    as a rollback trigger.
 * 3. Network activity can be counted, so request fan-out and payload size are
 *    recordable as ADR 0210 diagnostics without every spec wiring listeners.
 *
 * The first two hang off the *context*, not the page: a scenario opens a second
 * page for its cold-cache pass and both must be covered. Putting the error check
 * on `context` — which every test reaches through `page` — is also what makes it
 * unforgettable. As its own fixture it would only apply to the tests that
 * remembered to ask for it, which is exactly when it is least likely to happen.
 */

export type NetworkWindow = {
  reset(): void;
  /** RSC (flight) responses since the last reset. */
  rscResponses(): number;
  rscBytes(): number;
  requests(): number;
  scriptBytes(): number;
  /**
   * Whether an RSC response for this destination has been seen on this page.
   *
   * Cumulative rather than windowed: it is a fact about what the client router
   * has cached, which `reset()` must not erase.
   */
  hasPrefetched(url: string): boolean;
};

type InstantFixtures = {
  network: NetworkWindow;
};

/** Count requests, RSC payloads, and script bytes for one page. */
export function watchNetwork(page: Page): NetworkWindow {
  let requests = 0;
  let rscResponses = 0;
  let rscBytes = 0;
  let scriptBytes = 0;
  const prefetched = new Set<string>();

  page.on("request", () => {
    requests += 1;
  });

  page.on("response", (response: Response) => {
    const type = response.headers()["content-type"] ?? "";
    const length = Number(response.headers()["content-length"] ?? 0);
    const size = Number.isFinite(length) ? length : 0;

    if (type.includes("text/x-component")) {
      rscResponses += 1;
      rscBytes += size;
      prefetched.add(destinationOf(response.url()));
    }
    if (type.includes("javascript")) {
      scriptBytes += size;
    }
  });

  return {
    reset() {
      requests = 0;
      rscResponses = 0;
      rscBytes = 0;
      scriptBytes = 0;
    },
    rscResponses: () => rscResponses,
    rscBytes: () => rscBytes,
    requests: () => requests,
    scriptBytes: () => scriptBytes,
    hasPrefetched: (url) => prefetched.has(url),
  };
}

/** The destination an RSC request is for, with Next's cache-busting param removed. */
function destinationOf(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("_rsc");
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Collect runtime failures from every page in a context.
 *
 * The filter is deliberately narrow. An earlier version also dropped
 * "Failed to load resource", which is the browser's own wording for a 404 — and
 * would have swallowed exactly the segment-prefetch 404s this suite was built to
 * catch. A missing favicon and an aborted speculative request are the only two
 * that are genuinely not the application's problem.
 */
export function watchRuntimeErrors(context: BrowserContext): string[] {
  const errors: string[] = [];

  context.on("weberror", (error) => errors.push(`pageerror: ${error.error().message}`));
  context.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/favicon/i.test(text) || text.includes("ERR_ABORTED")) return;
    errors.push(`console: ${text}`);
  });

  return errors;
}

/**
 * Per-page request activity, so quiescence can be waited on more than once.
 *
 * Playwright's own `networkidle` load state is *latched*: it fires once per
 * document and every later `waitForLoadState("networkidle")` returns
 * immediately — the CI trace records it in as many words ("not waiting,
 * 'networkidle' event already fired") while six dynamic RSC prefetches were
 * still in flight. A suite that measures the first frame after a click cannot
 * use a one-shot signal to decide the page is quiet, so the fixture keeps its
 * own counter and {@link settleSourceSurface} waits on that instead.
 */
type PageActivity = { inflight: number; lastEventAt: number };

const pageActivity = new WeakMap<Page, PageActivity>();

function trackPageActivity(page: Page): PageActivity {
  const existing = pageActivity.get(page);
  if (existing) return existing;

  const state: PageActivity = { inflight: 0, lastEventAt: Date.now() };
  page.on("request", () => {
    state.inflight += 1;
    state.lastEventAt = Date.now();
  });
  const complete = () => {
    // Clamped, because a page can be tracked from partway through its first
    // load — the fixture attaches at creation, but a spec's second page reaches
    // here through `settleSourceSurface` — and a response whose request was
    // never counted must not drive the counter negative and read as quiet.
    state.inflight = Math.max(0, state.inflight - 1);
    state.lastEventAt = Date.now();
  };
  page.on("requestfinished", complete);
  page.on("requestfailed", complete);
  pageActivity.set(page, state);

  return state;
}

export const test = base.extend<InstantFixtures>({
  context: async ({ context }, use) => {
    await context.addInitScript(instrumentationScript(INSTRUMENTATION_KEY));
    context.on("page", trackPageActivity);
    const errors = watchRuntimeErrors(context);

    await use(context);

    expect(errors, "the destination produced no hydration or module failures").toEqual([]);
  },
  network: async ({ page }, use) => {
    await use(watchNetwork(page));
  },
});

export { expect } from "@playwright/test";

/**
 * Arrive at a surface through a hard load and wait for admission.
 *
 * Per ADR 0205 the prerendered frame is held out of the visual tree until fresh
 * request-bound admission streams, so the first paint of a hard load is the
 * owner-neutral access check — not the destination. Driving the matrix with
 * `page.goto` would measure that screen. Every scenario therefore arrives once,
 * waits here, and then measures real `<Link>` navigations, which is where the
 * prerendered shell actually pays off.
 */
export async function arriveAdmitted(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("[data-admitted]")).toBeAttached({ timeout: 30_000 });
  await settleSourceSurface(page);
}

/**
 * How long the page has to stay off the network before it counts as settled.
 *
 * Matches Playwright's own `networkidle` definition so the reading stays
 * comparable to the recorded 16.2 baseline; what changes is only that this one
 * can be asked again before every measured pass.
 */
const QUIET_WINDOW_MS = 500;

/**
 * Let the source surface finish hydrating and prefetching before it is measured
 * from.
 *
 * Without this the first click can land while the destination's shell prefetch
 * is still in flight, and the router then waits on the network — which measures
 * how fast the harness clicked, not whether the destination is instant. It is
 * also what makes the reading comparable to the recorded 16.2 baseline, whose
 * source shells had likewise completed their prefetches before the click, and
 * what `instant()` itself assumes ("all prefetches have completed").
 *
 * Waits on {@link PageActivity} rather than Playwright's `networkidle`, which
 * only ever fires once per document and so silently stops guarding anything
 * after the first pass. Bounded and fail-open, as before.
 */
export async function settleSourceSurface(page: Page, timeoutMs = 5_000) {
  const activity = trackPageActivity(page);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (activity.inflight === 0 && Date.now() - activity.lastEventAt >= QUIET_WINDOW_MS) return;
    await page.waitForTimeout(25);
  }
  // A surface that never goes quiet is a finding for the diagnostics, not a
  // reason to abandon the measurement.
}

/**
 * Wait until the destination's own prefetch has actually landed.
 *
 * Network idle is a proxy for "the source shell finished its work", and on a
 * quiet machine it is a good one. Under contention it is not: the source can go
 * idle while a destination prefetch is still being scheduled, and the click then
 * waits on the network — turning an instant-navigation budget into a measurement
 * of how busy the runner was. Waiting on the response itself makes "warm" mean
 * what `instant()` assumes it means.
 *
 * Bounded and fail-open. A destination that never prefetches is a finding the
 * measurement should record, not a reason to hang.
 */
export async function awaitDestinationPrefetch(
  page: Page,
  network: NetworkWindow,
  url: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;

  while (!network.hasPrefetched(url) && Date.now() < deadline) {
    await page.waitForTimeout(25);
  }
}

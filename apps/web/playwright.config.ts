import { defineConfig, devices } from "@playwright/test";
import { PRIMARY_OWNER } from "@tendnote/db/instant/fixture-data";
import {
  instantBaseUrl,
  instantScope,
  instantServerEnv,
  storageStatePath,
} from "./tests/instant/support/rig";

/**
 * The production-build Instant Interaction matrix (#310, ADR 0210).
 *
 * Tiering lives here rather than in the specs. `routine` is the Chromium
 * desktop-and-mobile matrix every application pull request runs; `full` adds the
 * reduced Firefox and WebKit promotion smoke that only the framework upgrade and
 * production promotion need. Contracting routine coverage further is a decision
 * ADR 0210 gates on three cache-warm CI runs, so it is not encoded here.
 */

const scope = instantScope();
const baseURL = instantBaseUrl();
const primaryStorageState = storageStatePath(PRIMARY_OWNER.userId);

/** The reduced cross-engine smoke: Today, person detail, Action reconciliation. */
const PROMOTION_SMOKE = /@promotion-smoke/;

const chromiumProjects = [
  {
    name: "desktop-chromium",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1440, height: 900 },
      storageState: primaryStorageState,
    },
    testIgnore: /mobile-.*\.spec\.ts$/,
  },
  {
    name: "mobile-chromium",
    use: {
      // The iPhone 13 profile on Chromium: viewport, user agent, and touch model
      // of the mobile product, on the engine ADR 0210 makes routine. This is the
      // same profile the recorded 16.2 baseline measured, so the comparison is
      // like for like.
      ...devices["iPhone 13"],
      browserName: "chromium" as const,
      defaultBrowserType: "chromium" as const,
      storageState: primaryStorageState,
    },
    testIgnore: /desktop-.*\.spec\.ts$/,
  },
];

const promotionProjects = [
  {
    name: "promotion-firefox",
    use: { ...devices["Desktop Firefox"], storageState: primaryStorageState },
    grep: PROMOTION_SMOKE,
    testIgnore: /mobile-.*\.spec\.ts$/,
  },
  {
    name: "promotion-webkit",
    use: { ...devices["Desktop Safari"], storageState: primaryStorageState },
    grep: PROMOTION_SMOKE,
    testIgnore: /mobile-.*\.spec\.ts$/,
  },
];

export default defineConfig({
  testDir: "./tests/instant",
  outputDir: "./.instant/test-results",
  // The browser job's whole justification is that it runs in parallel and stays
  // inside the existing verification budget (ADR 0210).
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["json", { outputFile: "./.instant/results.json" }]],
  globalSetup: "./tests/instant/support/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    // Timing budgets are the point of this suite; a throttled or contended
    // browser would measure the runner, not the application.
    launchOptions: { args: ["--disable-dev-shm-usage"] },
  },
  projects: scope === "full" ? [...chromiumProjects, ...promotionProjects] : chromiumProjects,
  webServer: {
    // A production build only. `next dev` does not prerender, so there is no
    // static shell for `instant()` to serve and every assertion would be vacuous.
    command: "pnpm exec next start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: instantServerEnv(),
  },
});

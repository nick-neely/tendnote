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

/**
 * The reduced cross-engine smoke: Today, person detail, Action reconciliation.
 *
 * Desktop only. Both promotion projects use desktop device profiles, so the
 * mobile specs are ignored below and deliberately carry no `@promotion-smoke`
 * tag — a tag they could never select would read as coverage that does not
 * exist.
 */
const PROMOTION_SMOKE = /@promotion-smoke/;

/**
 * Chromium-only launch flags.
 *
 * Scoped to the Chromium projects rather than set on the shared `use` block:
 * Playwright forwards `launchOptions.args` verbatim to whichever engine a
 * project selects, and WebKit rejects the whole command line on an argument it
 * does not know ("Cannot parse arguments: Unknown option
 * --disable-dev-shm-usage"), so every WebKit test fails at launch before it has
 * a page. Firefox tolerates it, which is why only the promotion tier — the tier
 * that runs WebKit — ever saw this.
 */
const CHROMIUM_LAUNCH = { args: ["--disable-dev-shm-usage"] };

const chromiumProjects = [
  {
    name: "desktop-chromium",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1440, height: 900 },
      storageState: primaryStorageState,
      launchOptions: CHROMIUM_LAUNCH,
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
      launchOptions: CHROMIUM_LAUNCH,
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
    // Defined unconditionally, and skipped with a reason when the rig cannot
    // carry it, rather than dropped from the project list when it cannot.
    //
    // WebKit will not send a `Secure` cookie over plain HTTP even to localhost,
    // so on the loopback rig the production `__Secure-` session cookie never
    // reaches the server and every spec lands on `/sign-in`; the attribute
    // cannot be dropped either, because Chromium rejects the `__Secure-` name
    // without it. A project that simply vanished on HTTP would make a green
    // `Promotion verify` look like three-engine evidence, which is the one thing
    // this must not do — so `engine-support.ts` supplies the skip reason, the
    // shared fixture applies it, and the CI step summary prints it. The gate
    // keys on the base URL's scheme rather than on the engine, so it would stop
    // skipping on its own if the rig were ever served over HTTPS; today nothing
    // does, and WebKit's evidence is the manual Safari pass of ADR 0211.
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
  // One worker on CI, deliberately. A GitHub-hosted runner is a two-vCPU
  // machine that is already hosting the measured `next start` alongside the
  // browser, so a second worker means two headless Chromiums and a server
  // contending for two cores — and every number this suite records is then a
  // reading of the runner rather than of the application. Measured: the same
  // rows that failed CI at two workers (`Today to Review` at 127 ms, `person
  // detail to Today` at 621 ms) come back at 35–57 ms on one core with one
  // worker. The tier still runs alongside the other verification jobs, which is
  // where ADR 0210's parallelism requirement actually lives.
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["json", { outputFile: "./.instant/results.json" }]],
  globalSetup: "./tests/instant/support/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
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

/**
 * Which engines the rig can honestly measure, and why one of them it cannot.
 *
 * Deliberately import-free. This module is exercised directly by
 * `scripts/instant-matrix-ci.test.ts`, which runs outside the web workspace, so
 * every input arrives as an argument rather than through `rig.ts` — the rule
 * that decides whether a browser is skipped is then the same object the unit
 * test asserts against, not a paraphrase of it.
 */

/**
 * Why WebKit cannot run against a plain-HTTP rig.
 *
 * Long on purpose: this string is the annotation Playwright prints for every
 * skipped WebKit test and the line
 * `scripts/summarize-instant-diagnostics.mjs` writes into the CI step summary.
 * It is the whole defence against reading a green `Promotion verify` as WebKit
 * evidence, so it has to say what did not happen and where it happens instead.
 */
export const WEBKIT_LOOPBACK_SKIP_REASON =
  "WebKit is NOT covered by this run. The rig serves plain HTTP on loopback, and " +
  "WebKit — unlike Chromium and Firefox — will not send a `Secure` cookie over " +
  "HTTP even to localhost, so the production `__Secure-` session cookie never " +
  "reaches the server and every spec lands on /sign-in. Dropping the attribute is " +
  "not available either: Chromium rejects the `__Secure-` name without it. WebKit " +
  "engine evidence is produced by hand against a real HTTPS origin, in Q1.6 and Q2.5 of " +
  "the Preview qualification runbook (docs/verification/nextjs-16-3-preview-qualification.md). " +
  "No configuration points this matrix at a deployed origin, and none is planned; the gate " +
  "keys on the base URL's scheme rather than on the engine, so it would stop skipping on " +
  "its own if the rig were ever served over HTTPS.";

/**
 * The skip reason for this engine on this rig, or `null` when it can run.
 *
 * @param browserName Playwright's engine name for the project under test.
 * @param baseUrl The URL the browser actually talks to — `instantBaseUrl()`.
 */
export function unsupportedEngineReason(browserName: string, baseUrl: string): string | null {
  if (browserName !== "webkit") return null;

  let protocol: string;
  try {
    protocol = new URL(baseUrl).protocol;
  } catch {
    // An unparseable base URL is not an HTTPS origin, and guessing that it might
    // be would turn this guard into the silent pass it exists to prevent.
    return WEBKIT_LOOPBACK_SKIP_REASON;
  }

  return protocol === "https:" ? null : WEBKIT_LOOPBACK_SKIP_REASON;
}

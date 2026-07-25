import { LOCK_PROOF_OWNER_TEXT, LOCK_PROOF_PATH } from "@tendnote/db/instant/fixture-data";
import { instantBaseUrl } from "./rig";

/**
 * Prove the instant-navigation lock is actually engaged before any spec runs.
 *
 * `instant()` is a cookie protocol: with
 * `experimental.exposeTestingApiInProductionBuild` unset, a production build
 * ignores the cookie entirely and `instant()` becomes a no-op. Every assertion
 * written inside it then runs against fully streamed content and passes — a
 * green suite that proves nothing at all. That is the single most dangerous
 * failure mode of this harness, so it is checked directly rather than inferred.
 *
 * The check is a plain document request, not a browser assertion, because it
 * must not depend on client router cache state: two fetches for the same
 * admitted route, one with the lock cookie and one without. With the flag on,
 * the locked response carries the static shell only and the owner's data is
 * absent; with the flag off, both responses are identical. A build that fails
 * this stops the run with an explanation instead of reporting success.
 */

const LOCK_COOKIE = "next-instant-navigation-testing=1";

export async function assertInstantLockEngaged(sessionCookie: string) {
  const url = new URL(LOCK_PROOF_PATH, instantBaseUrl()).toString();

  const [unlocked, locked] = await Promise.all([
    fetchBody(url, sessionCookie),
    fetchBody(url, `${sessionCookie}; ${LOCK_COOKIE}`),
  ]);

  if (!unlocked.includes(LOCK_PROOF_OWNER_TEXT)) {
    throw new Error(
      `The Instant matrix fixture is not reaching ${LOCK_PROOF_PATH}: an ordinary admitted request did not contain ${JSON.stringify(
        LOCK_PROOF_OWNER_TEXT,
      )}. Check the seeded database, the session cookie, and Private Beta Access before reading any timing.`,
    );
  }

  if (locked.includes(LOCK_PROOF_OWNER_TEXT)) {
    throw new Error(
      "The measured build did not expose Next's instant-navigation testing API: a request carrying the instant-navigation cookie still streamed owner data. " +
        "`instant()` would silently no-op and every assertion inside it would pass vacuously. " +
        "Rebuild with TENDNOTE_INSTANT_MATRIX=1 (see apps/web/src/lib/instant/testing-api.ts).",
    );
  }
}

async function fetchBody(url: string, cookie: string): Promise<string> {
  const response = await fetch(url, { headers: { cookie } });
  if (!response.ok) {
    throw new Error(`The Instant matrix rig returned ${response.status} for ${url}.`);
  }
  return response.text();
}

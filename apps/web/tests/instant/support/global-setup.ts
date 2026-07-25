import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ISOLATION_OWNER, PRIMARY_OWNER } from "@tendnote/db/instant/fixture-data";
import { assertInstantLockEngaged } from "./lock-proof";
import { instantBaseUrl, instantServerEnv, storageStatePath } from "./rig";

/**
 * Prepares the deterministic fixture once per run: reset and seed both synthetic
 * owners, then mint a real Better Auth session for each and persist it as a
 * Playwright storage state.
 *
 * This runs before the web server starts, so the measured server never observes
 * a half-seeded database.
 */
const run = promisify(execFile);

async function seedFixtureDatabase() {
  const { stdout } = await run("pnpm", ["--filter", "@tendnote/db", "db:instant:seed"], {
    cwd: join(__dirname, "..", "..", "..", "..", ".."),
    env: process.env,
  });
  console.log(stdout.trim().split("\n").at(-1));
}

export default async function globalSetup() {
  // The fixture, the server, and the browser must agree on database, cache,
  // clock, and signing key. Applying the rig environment here means the seed and
  // the session mint both run against the same one the server will.
  Object.assign(process.env, instantServerEnv());

  // Seeding runs as its own `tsx` process rather than an import: it is the same
  // command CI and a developer run by hand, and it keeps the migration runner
  // (which resolves its folder from `import.meta.url`) out of Playwright's
  // CommonJS transform.
  await seedFixtureDatabase();

  const { mintOwnerSession } = await import("./session");
  let primaryCookie = "";

  for (const owner of [PRIMARY_OWNER, ISOLATION_OWNER]) {
    const { cookieName, cookieValue } = await mintOwnerSession(owner.userId);
    if (owner === PRIMARY_OWNER) primaryCookie = `${cookieName}=${cookieValue}`;
    const path = storageStatePath(owner.userId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify(
        {
          cookies: [
            {
              name: cookieName,
              value: cookieValue,
              domain: new URL(instantBaseUrl()).hostname,
              path: "/",
              expires: Math.floor(Date.now() / 1000) + 60 * 60,
              httpOnly: true,
              // Not negotiable, and tried: the cookie Better Auth mints in
              // production is `__Secure-`prefixed, and Chromium enforces that
              // prefix on injection too — a storage state carrying the same
              // cookie with `secure: false` is refused outright with
              // `Storage.setCookies: Invalid cookie fields`, and all 19 routine
              // tests fail before their first navigation. So the rig cannot
              // sidestep WebKit's refusal to put a `Secure` cookie on a
              // plain-HTTP socket by dropping the attribute; see `rig.ts`.
              secure: true,
              sameSite: "Lax" as const,
            },
          ],
          origins: [],
        },
        null,
        2,
      ),
    );
  }

  // Last, because it needs both the seeded owner and a live server: refuse to
  // report a green matrix against a build where `instant()` is a no-op.
  await waitForServer();
  await assertInstantLockEngaged(primaryCookie);
}

/**
 * Playwright starts the configured web server alongside global setup rather
 * than strictly before it, so the lock proof waits for the socket itself.
 */
async function waitForServer() {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(instantBaseUrl(), { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`The Instant matrix rig never answered on ${instantBaseUrl()}.`);
}

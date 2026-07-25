/**
 * The measured production rig for the Instant Interaction matrix (#310).
 *
 * ## Why a local production build, not `next dev`
 *
 * `next dev` does not prerender, so there is no static shell to assert against
 * and `instant()` has nothing to serve. Every gate in ADR 0210 is a statement
 * about the built shell, so the matrix only runs against `next build` +
 * `next start`.
 *
 * ## Why the canonical URL is HTTPS while the socket is HTTP
 *
 * `next start` sets `NODE_ENV=production`, and Tendnote's shared Better Auth
 * baseline (`packages/auth/src/server.ts`) then requires an HTTPS
 * `BETTER_AUTH_URL` and switches on `useSecureCookies`. Both are correct
 * production behaviour and neither is weakened here: the rig supplies an HTTPS
 * canonical URL and serves plain HTTP on loopback, exactly as the recorded 16.2
 * baseline did (`docs/research/nextjs-16-current-navigation-baseline.md`,
 * "Runtime"). The session cookie is therefore the production `__Secure-`prefixed
 * one, minted and signed by Better Auth itself.
 *
 * Whether a browser will *send* that cookie over a plain-HTTP loopback socket is
 * not universal, though, and the promotion tier proved it: Chromium and Firefox
 * treat `http://localhost` as a trustworthy origin and send it, WebKit does not.
 * On WebKit every request arrived with no `Cookie` header at all and all five
 * promotion specs landed on `/sign-in`. The rig cannot work around it, and the
 * three constraints that collide are each deliberate — see
 * `docs/verification/nextjs-16-3-preview-qualification.md` for the evidence.
 * WebKit's engine evidence belongs to an origin that really is HTTPS, and is
 * produced by hand in Q1.6 and Q2.5 of the Preview qualification of ADR 0211 —
 * nothing points this matrix at a deployed origin, and nothing is meant to.
 *
 * The one thing this shape does not exercise is a browser-issued Better Auth API
 * call, whose `Origin` would be `http://localhost:PORT` against a trusted origin
 * of `https://localhost:PORT`. The matrix never signs in through the browser —
 * it injects an already-minted session — and ADR 0211 puts the real-origin
 * qualification on the Vercel Preview (#311), where the scheme genuinely is
 * HTTPS. Terminating TLS locally was rejected because a proxy hop sits inside
 * the streaming path this suite exists to measure.
 */

import { join } from "node:path";
import { instantDatabaseUrl } from "@tendnote/db/instant/fixture-data";

const DEFAULT_PORT = 3110;
const DEFAULT_REDIS = "redis://localhost:56379";

/**
 * A dedicated logical Redis database so rig sessions never collide with the
 * developer's own dev-server session state.
 */
const RIG_REDIS_DATABASE = 9;

/**
 * The rig's Better Auth signing key. Deterministic on purpose: the fixture mints
 * a session in one process and the server verifies it in another, so both must
 * agree without a handshake. It only ever signs synthetic owners on a loopback
 * build and is not a deployment secret.
 */
const RIG_BETTER_AUTH_SECRET = "tendnote-instant-matrix-rig-secret-0000000";

function withPath(url: string, path: string): string {
  const parsed = new URL(url);
  parsed.pathname = path;
  return parsed.toString();
}

export function instantRedisUrl(): string {
  if (process.env.TENDNOTE_INSTANT_REDIS_URL) return process.env.TENDNOTE_INSTANT_REDIS_URL;
  return withPath(process.env.REDIS_URL ?? DEFAULT_REDIS, `/${RIG_REDIS_DATABASE}`);
}

export function instantPort(): number {
  return Number(process.env.TENDNOTE_INSTANT_PORT ?? DEFAULT_PORT);
}

/** Where Playwright and the browser actually talk to the server. */
export function instantBaseUrl(): string {
  return `http://localhost:${instantPort()}`;
}

/** What Better Auth is told its canonical origin is. See the module comment. */
export function instantCanonicalUrl(): string {
  return `https://localhost:${instantPort()}`;
}

export function instantBetterAuthSecret(): string {
  return process.env.TENDNOTE_INSTANT_BETTER_AUTH_SECRET ?? RIG_BETTER_AUTH_SECRET;
}

/**
 * The environment shared by the measured build, the measured server, and the
 * fixture process. Anything that changes rendering or identity has to be
 * identical across all three or the matrix measures a different application than
 * it seeded.
 */
export function instantServerEnv(): Record<string, string> {
  return {
    NODE_ENV: "production",
    TENDNOTE_INSTANT_MATRIX: "1",
    PORT: String(instantPort()),
    // The same resolver the seeder uses, so the measured server can never read a
    // different database than was seeded.
    DATABASE_URL: instantDatabaseUrl(),
    REDIS_URL: instantRedisUrl(),
    BETTER_AUTH_URL: instantCanonicalUrl(),
    BETTER_AUTH_SECRET: instantBetterAuthSecret(),
    NEXT_PUBLIC_APP_URL: instantBaseUrl(),
    // Deterministic clock domain for every date the product renders.
    TZ: "UTC",
    TENDNOTE_OWNER_TIMEZONE: "UTC",
    // The local demo owner must stay unreachable: the rig proves the real
    // admitted path, and a fallback owner would hide a broken one.
    TENDNOTE_DEV_OWNER_USER_ID: "",
    // No provider credentials, no Eve model calls, no outbound network.
    AI_GATEWAY_API_KEY: "",
    VERCEL_OIDC_TOKEN: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    DISCORD_CLIENT_ID: "",
    DISCORD_CLIENT_SECRET: "",
    TENDNOTE_EMBEDDING_RUNTIME: "enqueue_only",
  };
}

/**
 * Where a minted owner session is persisted between global setup and the specs.
 *
 * `__dirname` rather than `import.meta.url`: every module in this directory is
 * loaded by Playwright's CommonJS transform, which has no `import.meta`.
 */
export function instantArtifactDir(): string {
  return join(__dirname, "..", "..", "..", ".instant");
}

export function storageStatePath(ownerUserId: string): string {
  return join(instantArtifactDir(), `${ownerUserId}.json`);
}

/** Which slice of the matrix this run is. See ADR 0210's tiering. */
export type InstantScope = "routine" | "full";

export function instantScope(): InstantScope {
  return process.env.TENDNOTE_INSTANT_SCOPE === "full" ? "full" : "routine";
}

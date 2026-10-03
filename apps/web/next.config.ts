import { withEve } from "eve/next";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { cacheProfiles } from "./src/lib/cache/cache-profiles";
import { exposesInstantTestingApiFromProcess } from "./src/lib/instant/testing-api";
import { segmentPrefetchRewrites } from "./src/lib/navigation/segment-prefetch-rewrites";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheLife: cacheProfiles,
  partialPrefetching: true,
  reactCompiler: true,
  async headers() {
    return [
      {
        // A Household Invitation link carries its capability in the URL, so the
        // acceptance page must never hand that URL to anything it links or
        // navigates to (OWASP Forgot Password Cheat Sheet, URL tokens).
        source: "/join/:token*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: segmentPrefetchRewrites(),
      afterFiles: [],
      fallback: [],
    };
  },
  transpilePackages: ["@tendnote/db", "@tendnote/domain", "@tendnote/ui"],
  experimental: {
    // Only `next dev` reads this (#684, ADR 0255). Next's Cache Components
    // validation worker loads a second copy of the app and retained about 8 MiB
    // more per page request, so a dev session grew until the 8 GB VM ran out. In
    // process, validation shares the dev server's modules and stays flat;
    // navigations wait on it instead.
    devValidationWorker: false,
    // Instant Interaction gate (#310, ADR 0210). `instant()` silently no-ops
    // without this, so a measured build must opt in explicitly; the gate refuses
    // to turn it on for the real production deployment.
    exposeTestingApiInProductionBuild: exposesInstantTestingApiFromProcess(),
    serverActions: {
      // Asset Evidence uploads (#200): the domain caps files at 10 MB
      // (ASSET_EVIDENCE_MAX_FILE_BYTES); leave headroom for multipart overhead.
      bodySizeLimit: "12mb",
    },
  },
};

/**
 * `next dev` runs the React Compiler as Turbopack's native Rust port (ADR 0255).
 * The Babel version runs in Node loader workers that held about 0.9 GiB on the
 * 8 GB development VM (#684). Builds keep the Babel compiler, so what ships and
 * what the Instant matrix measures do not ride on the experimental port.
 */
export function nextConfigForPhase(phase: string): NextConfig {
  return {
    ...nextConfig,
    experimental: {
      ...nextConfig.experimental,
      turbopackRustReactCompiler: phase === PHASE_DEVELOPMENT_SERVER,
    },
  };
}

// Mount the Eve agent (apps/agent) at the same origin. In dev withEve spawns
// `eve dev` for the agent and rewrites /eve/v1/* to it, so the browser streams
// turns same-origin (no CORS, no TENDNOTE_EVE_URL) via useEveAgent.
export default withEve(nextConfigForPhase, { eveRoot: "../agent" });

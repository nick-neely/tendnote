import { withEve } from "eve/next";
import type { NextConfig } from "next";
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
  transpilePackages: ["@tendnote/db", "@tendnote/domain"],
  experimental: {
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

// Mount the Eve agent (apps/agent) at the same origin. In dev withEve spawns
// `eve dev` for the agent and rewrites /eve/v1/* to it, so the browser streams
// turns same-origin (no CORS, no TENDNOTE_EVE_URL) via useEveAgent.
export default withEve(nextConfig, { eveRoot: "../agent" });

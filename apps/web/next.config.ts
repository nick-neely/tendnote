import { withEve } from "eve/next";
import type { NextConfig } from "next";
import { cacheProfiles } from "./src/lib/cache/cache-profiles";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheLife: cacheProfiles,
  partialPrefetching: true,
  reactCompiler: true,
  async rewrites() {
    const segmentPrefetch = {
      type: "header" as const,
      key: "next-router-segment-prefetch",
      // Next sends a leading slash followed by the generated segment key.
      // Capture only the key so it can be appended to the artifact directory.
      value: "/(?<segmentPath>[A-Za-z0-9_!$~/-]+)",
    };

    return {
      beforeFiles: [
        // The root route's generated artifact directory is named `index.segments`.
        {
          source: "/",
          has: [segmentPrefetch],
          destination: "/index.segments/:segmentPath.segment.rsc",
        },
        // Vercel's static router does not currently apply Next's segment-prefetch
        // suffix metadata, so map the header-form request to the emitted artifact
        // before filesystem routing. Ordinary documents and RSC requests do not
        // carry this header and therefore never match.
        {
          source: "/:path+",
          has: [segmentPrefetch],
          destination: "/:path+.segments/:segmentPath.segment.rsc",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  transpilePackages: ["@tendnote/db", "@tendnote/domain"],
  experimental: {
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

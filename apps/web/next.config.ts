import { withEve } from "eve/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
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

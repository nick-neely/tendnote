import type { NextConfig } from "next";
import { legacyAppRedirects } from "./src/lib/site-links";

// The marketing site is static and has no authentication: it never reads the
// product session and sets no cookies. Its only telemetry is the anonymous
// public activity counter it reports to the product app (#646).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tendnote/domain", "@tendnote/ui"],
  redirects: async () => legacyAppRedirects(),
};

export default nextConfig;

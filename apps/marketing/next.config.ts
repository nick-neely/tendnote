import type { NextConfig } from "next";

// The marketing site is static and has no authentication: it never reads the
// product session, sets no cookies, and runs no tracking of its own.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tendnote/ui"],
};

export default nextConfig;

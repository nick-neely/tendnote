import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@tendnote/db", "@tendnote/domain"],
};

export default nextConfig;

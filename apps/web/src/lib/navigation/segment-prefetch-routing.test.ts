import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = join(import.meta.dirname, "../../..");

describe("segment prefetch routing", () => {
  it("maps header-form partial prefetches to generated segment artifacts", () => {
    const nextConfig = readFileSync(join(webRoot, "next.config.ts"), "utf8");

    expect(nextConfig).toContain('key: "next-router-segment-prefetch"');
    expect(nextConfig).toContain('value: "/(?<segmentPath>[A-Za-z0-9_!$~/-]+)"');
    expect(nextConfig).toContain('key: "__tendnote_segment_artifact"');
    expect(nextConfig).toContain("missing: [notSegmentArtifact]");
    expect(nextConfig).toContain(
      '"/index.segments/:segmentPath.segment.rsc?__tendnote_segment_artifact=1"',
    );
    expect(nextConfig).toContain(
      '"/:path+.segments/:segmentPath.segment.rsc?__tendnote_segment_artifact=1"',
    );
  });
});

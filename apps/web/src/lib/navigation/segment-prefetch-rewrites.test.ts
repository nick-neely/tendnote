import { describe, expect, it } from "vitest";
import { segmentPrefetchRewrites } from "./segment-prefetch-rewrites";

describe("segment prefetch rewrites", () => {
  it("routes header-form segment prefetches to their artifacts on Vercel", () => {
    const rules = segmentPrefetchRewrites({ vercel: "1" });

    expect(
      rules.map((rule) => ({
        source: rule.source,
        destination: rule.destination,
        has: rule.has.map((condition) => condition.key),
        missing: rule.missing.map((condition) => condition.key),
      })),
    ).toEqual([
      {
        source: "/",
        destination: "/index.segments/:segmentPath.segment.rsc?__tendnote_segment_artifact=1",
        has: ["next-router-segment-prefetch"],
        // Without this guard the rewritten request matches the rule again.
        missing: ["__tendnote_segment_artifact"],
      },
      {
        source: "/:path+",
        destination: "/:path+.segments/:segmentPath.segment.rsc?__tendnote_segment_artifact=1",
        has: ["next-router-segment-prefetch"],
        missing: ["__tendnote_segment_artifact"],
      },
    ]);
  });

  it("leaves segment prefetching to the server everywhere else", () => {
    // `next start` serves segment artifacts from `.next/server/app`, which is not
    // a routable path: rewriting there turns a request the server could answer
    // into a 404 and silently disables reusable-shell prefetching.
    expect(segmentPrefetchRewrites({ vercel: undefined })).toEqual([]);
    expect(segmentPrefetchRewrites({ vercel: "0" })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  NEXT_ROUTER_PREFETCH_HEADER,
  NEXT_ROUTER_SEGMENT_PREFETCH_HEADER,
  normalizeVercelSegmentPrefetchHeaders,
} from "./segment-prefetch-request";

describe("normalizeVercelSegmentPrefetchHeaders", () => {
  it("upgrades Vercel's header-form segment prefetch variant to the artifact-compatible variant", () => {
    const headers = new Headers({
      [NEXT_ROUTER_PREFETCH_HEADER]: "1",
      [NEXT_ROUTER_SEGMENT_PREFETCH_HEADER]: "/_tree",
      rsc: "1",
    });

    const normalized = normalizeVercelSegmentPrefetchHeaders(headers, { vercel: "1" });

    expect(normalized?.get(NEXT_ROUTER_PREFETCH_HEADER)).toBe("2");
    expect(normalized?.get(NEXT_ROUTER_SEGMENT_PREFETCH_HEADER)).toBe("/_tree");
    expect(normalized?.get("rsc")).toBe("1");
    expect(headers.get(NEXT_ROUTER_PREFETCH_HEADER)).toBe("1");
  });

  it("leaves ordinary, incomplete, and non-Vercel requests unchanged", () => {
    expect(
      normalizeVercelSegmentPrefetchHeaders(new Headers({ [NEXT_ROUTER_PREFETCH_HEADER]: "1" }), {
        vercel: "1",
      }),
    ).toBeUndefined();
    expect(
      normalizeVercelSegmentPrefetchHeaders(
        new Headers({ [NEXT_ROUTER_SEGMENT_PREFETCH_HEADER]: "/_tree" }),
        { vercel: "1" },
      ),
    ).toBeUndefined();
    expect(
      normalizeVercelSegmentPrefetchHeaders(
        new Headers({
          [NEXT_ROUTER_PREFETCH_HEADER]: "1",
          [NEXT_ROUTER_SEGMENT_PREFETCH_HEADER]: "/_tree",
        }),
        { vercel: undefined },
      ),
    ).toBeUndefined();
  });
});

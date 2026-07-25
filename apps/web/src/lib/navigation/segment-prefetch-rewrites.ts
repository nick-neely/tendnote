import type { NextConfig } from "next";

type Rewrites = Awaited<ReturnType<NonNullable<NextConfig["rewrites"]>>>;
type RewriteRules = Exclude<Rewrites, unknown[]>;

/**
 * Map Next's header-form segment-prefetch request onto the artifact the build
 * emitted — but only where the host actually needs it.
 *
 * Vercel's static router does not currently apply Next's segment-prefetch suffix
 * metadata, so without these rules every reusable-shell prefetch on a Preview or
 * production deployment 404s and the navigation falls back to a full RSC fetch
 * (#309, `docs/verification/nextjs-16-3-partial-prefetching.md`).
 *
 * `next start` needs the opposite: it serves segment artifacts itself, from
 * `.next/server/app/<route>.segments/`, which is *not* a routable path. Applying
 * the rewrite there rewrites a request the server could have answered into one
 * it cannot, so every shell prefetch 404s and the very behaviour the Instant
 * matrix measures is disabled. The rules are therefore gated on the deployment
 * that needs them rather than applied everywhere.
 *
 * `VERCEL` is read at build time, which is correct: rewrites are compiled into
 * the routes manifest, so this decision is made once per build, alongside the
 * artifacts it routes to.
 */
export function segmentPrefetchRewrites(env: { vercel?: string } = { vercel: process.env.VERCEL }) {
  if (env.vercel !== "1") return [];

  const segmentPrefetch = {
    type: "header" as const,
    key: "next-router-segment-prefetch",
    // Next sends a leading slash followed by the generated segment key.
    // Capture only the key so it can be appended to the artifact directory.
    value: "/(?<segmentPath>[A-Za-z0-9_!$~/-]+)",
  };
  const notSegmentArtifact = {
    type: "query" as const,
    key: "__tendnote_segment_artifact",
  };

  return [
    // The root route's generated artifact directory is named `index.segments`.
    {
      source: "/",
      has: [segmentPrefetch],
      missing: [notSegmentArtifact],
      destination: "/index.segments/:segmentPath.segment.rsc?__tendnote_segment_artifact=1",
    },
    // Ordinary documents and RSC requests do not carry this header and therefore
    // never match.
    {
      source: "/:path+",
      has: [segmentPrefetch],
      missing: [notSegmentArtifact],
      destination: "/:path+.segments/:segmentPath.segment.rsc?__tendnote_segment_artifact=1",
    },
  ] satisfies RewriteRules["beforeFiles"];
}

export const NEXT_ROUTER_PREFETCH_HEADER = "next-router-prefetch";
export const NEXT_ROUTER_SEGMENT_PREFETCH_HEADER = "next-router-segment-prefetch";

/**
 * Vercel's static router serves the segment artifact when Next's prefetch variant
 * is 2 or 3. Variant 1 is the shell-only request, which currently misses the
 * generated artifact route after the segment rewrite. Normalize only that exact
 * Vercel request; local `next start` has its own artifact handling.
 */
export function normalizeVercelSegmentPrefetchHeaders(
  headers: Headers,
  env: { vercel?: string } = { vercel: process.env.VERCEL },
): Headers | undefined {
  if (
    env.vercel !== "1" ||
    headers.get(NEXT_ROUTER_PREFETCH_HEADER) !== "1" ||
    !headers.get(NEXT_ROUTER_SEGMENT_PREFETCH_HEADER)
  ) {
    return undefined;
  }

  const normalized = new Headers(headers);
  normalized.set(NEXT_ROUTER_PREFETCH_HEADER, "2");
  return normalized;
}

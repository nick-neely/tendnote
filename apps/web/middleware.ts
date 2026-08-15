import { type NextRequest, NextResponse } from "next/server";
import { normalizeVercelSegmentPrefetchHeaders } from "./src/lib/navigation/segment-prefetch-request";

/**
 * Keep Vercel's header-form segment prefetch compatible with the artifact rewrite
 * in `next.config.ts`. The established middleware entrypoint is still the one
 * Vercel's current build integration invokes for this static RSC request. The
 * middleware only changes the exact Vercel prefetch variant that misses the
 * generated artifact route; ordinary navigation and local `next start` are inert.
 */
export function middleware(request: NextRequest) {
  const headers = normalizeVercelSegmentPrefetchHeaders(request.headers);
  return headers ? NextResponse.next({ request: { headers } }) : NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

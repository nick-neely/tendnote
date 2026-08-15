import { type NextRequest, NextResponse } from "next/server";
import { normalizeVercelSegmentPrefetchHeaders } from "./src/lib/navigation/segment-prefetch-request";

/**
 * Keep Vercel's header-form segment prefetch compatible with the artifact rewrite
 * in `next.config.ts`. Proxy runs before `beforeFiles`, so the normalized request
 * reaches the generated `.segment.rsc` route without changing ordinary navigation.
 */
export function proxy(request: NextRequest) {
  const headers = normalizeVercelSegmentPrefetchHeaders(request.headers);
  return headers ? NextResponse.next({ request: { headers } }) : NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

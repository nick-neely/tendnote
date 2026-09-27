import type { NextRequest } from "next/server";
import { regionBlockResponse } from "@/lib/access/region-block";

export function proxy(request: NextRequest) {
  return regionBlockResponse(request) ?? undefined;
}

export const config = {
  // Static assets and the PWA files are never refused, so the region page and
  // any cached shell still load their styles, scripts, and icons.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icons/|sw\\.js|offline-v2\\.html|manifest\\.webmanifest).*)",
  ],
};

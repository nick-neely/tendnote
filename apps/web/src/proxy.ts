import { isServiceWideHoldActive } from "@tendnote/db/queries/service-wide-hold";
import type { NextRequest } from "next/server";
import { regionBlockResponse } from "@/lib/access/region-block";
import { createServiceHoldCheck, serviceHoldResponse } from "@/lib/access/service-wide-hold-gate";

const isServiceHeld = createServiceHoldCheck({ read: isServiceWideHoldActive, logger: console });

export async function proxy(request: NextRequest) {
  return (
    (await serviceHoldResponse(request, isServiceHeld)) ?? regionBlockResponse(request) ?? undefined
  );
}

export const config = {
  // Static assets and the PWA files are never refused, so the region page and
  // any cached shell still load their styles, scripts, and icons.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icons/|sw\\.js|offline-v2\\.html|manifest\\.webmanifest).*)",
  ],
};

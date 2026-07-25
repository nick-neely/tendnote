"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { RouteReserve } from "@/components/route-reserve";

/**
 * Keeps the prerendered fallback truthful for both Home tabs, then names the
 * exact destination as soon as the client navigation URL is available.
 */
export function RouteAwareHomeReserve() {
  return (
    <Suspense fallback={<RouteReserve title="Today and Review" />}>
      <ResolvedHomeReserve />
    </Suspense>
  );
}

function ResolvedHomeReserve() {
  const searchParams = useSearchParams();
  return <RouteReserve title={searchParams.get("tab") === "review" ? "Review" : "Today"} />;
}

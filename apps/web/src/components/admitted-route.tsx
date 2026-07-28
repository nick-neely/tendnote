import { type ReactNode, Suspense } from "react";
import type { AppDestinationId } from "@/components/app-destinations";
import { RouteReserve } from "@/components/route-reserve";

/**
 * Supplies the destination segment beneath the persistent admitted layout.
 * Owner-scoped content remains independently streamed behind a truthful reserve.
 */
export function AdmittedRoute({
  children,
  destination,
}: {
  children: ReactNode;
  destination: AppDestinationId;
}) {
  return <Suspense fallback={<RouteReserve destination={destination} />}>{children}</Suspense>;
}

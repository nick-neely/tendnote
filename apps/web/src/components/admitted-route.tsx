import { type ReactNode, Suspense } from "react";
import { RouteReserve } from "@/components/route-reserve";

/**
 * Supplies the destination segment beneath the persistent admitted layout.
 * Owner-scoped content remains independently streamed behind a truthful reserve.
 */
export function AdmittedRoute({
  children,
  mobileDestination,
  title,
}: {
  children: ReactNode;
  mobileDestination?: ReactNode;
  title: string;
}) {
  return (
    <>
      {mobileDestination ? (
        <div className="lg:hidden">
          <Suspense fallback={<RouteReserve title={title} />}>{mobileDestination}</Suspense>
        </div>
      ) : null}
      <div className={mobileDestination ? "hidden lg:contents" : undefined}>
        <Suspense fallback={<RouteReserve title={title} />}>{children}</Suspense>
      </div>
    </>
  );
}

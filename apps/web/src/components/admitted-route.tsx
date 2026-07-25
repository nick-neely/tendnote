import { type ReactNode, Suspense } from "react";
import { AccessCheckFallback } from "@/components/access-check-fallback";
import { AppShell } from "@/components/app-shell";
import { RouteReserve } from "@/components/route-reserve";
import { requireAdmittedOwner } from "@/lib/access/current-access";

/**
 * Resolves request-bound admission before revealing the app frame. Product
 * children remain independently streamed behind a truthful destination reserve.
 */
export function AdmittedRoute({
  children,
  mobileDestination,
  mobileHome = false,
  mobileReview = false,
  returnTo,
  title,
}: {
  children: ReactNode;
  mobileDestination?: ReactNode;
  mobileHome?: boolean;
  mobileReview?: boolean;
  returnTo: Promise<string> | string;
  title: string;
}) {
  return (
    <Suspense fallback={<AccessCheckFallback />}>
      <AdmittedRouteContent
        mobileDestination={mobileDestination}
        mobileHome={mobileHome}
        mobileReview={mobileReview}
        returnTo={returnTo}
        title={title}
      >
        {children}
      </AdmittedRouteContent>
    </Suspense>
  );
}

async function AdmittedRouteContent({
  children,
  mobileDestination,
  mobileHome,
  mobileReview,
  returnTo,
  title,
}: {
  children: ReactNode;
  mobileDestination?: ReactNode;
  mobileHome: boolean;
  mobileReview: boolean;
  returnTo: Promise<string> | string;
  title: string;
}) {
  const ownerUserId = await requireAdmittedOwner({ returnTo: await returnTo });
  return (
    <AppShell
      mobileDestination={
        mobileDestination ? (
          <Suspense fallback={<RouteReserve title={title} />}>{mobileDestination}</Suspense>
        ) : undefined
      }
      mobileHome={mobileHome}
      mobileReview={mobileReview}
      ownerUserId={ownerUserId}
    >
      <Suspense fallback={<RouteReserve title={title} />}>{children}</Suspense>
    </AppShell>
  );
}

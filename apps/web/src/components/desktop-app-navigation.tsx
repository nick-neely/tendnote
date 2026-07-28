"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  appDestination,
  destinationsInGroup,
  isDestinationCurrentInGroup,
} from "@/components/app-destinations";
import { Button } from "@/components/ui/button";

export function DesktopAppNavigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {destinationsInGroup("desktop-primary").map((item) => {
        const Icon = item.icon;
        const active = isDestinationCurrentInGroup(
          item.id,
          "desktop-primary",
          pathname,
          searchParams,
        );
        return (
          <Button asChild key={item.id} variant="ghost">
            <Link aria-current={active ? "page" : undefined} href={appDestination(item.id).route}>
              <Icon aria-hidden data-icon="inline-start" />
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

/** Stable primary-navigation geometry while route-aware current state resolves. */
export function DesktopAppNavigationFallback() {
  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {destinationsInGroup("desktop-primary").map((item) => {
        const Icon = item.icon;
        return (
          <Button asChild key={item.id} variant="ghost">
            <Link href={appDestination(item.id).route}>
              <Icon aria-hidden data-icon="inline-start" />
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

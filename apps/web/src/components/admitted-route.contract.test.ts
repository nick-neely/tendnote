import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "admitted-route.tsx"), "utf8");
const layoutSource = readFileSync(
  join(import.meta.dirname, "../app/(admitted)/layout.tsx"),
  "utf8",
);
const globalsSource = readFileSync(join(import.meta.dirname, "../app/globals.css"), "utf8");
const homeSource = readFileSync(join(import.meta.dirname, "../app/(admitted)/page.tsx"), "utf8");
const homeReserveSource = readFileSync(
  join(import.meta.dirname, "mobile-home-reserve.tsx"),
  "utf8",
);
const dashboardFrameSource = readFileSync(join(import.meta.dirname, "dashboard-frame.tsx"), "utf8");
const mobileShellSource = readFileSync(join(import.meta.dirname, "mobile-shell.tsx"), "utf8");
const appShellSource = readFileSync(join(import.meta.dirname, "app-shell.tsx"), "utf8");
const contactImportSource = readFileSync(
  join(import.meta.dirname, "../app/(admitted)/account/contacts/import/page.tsx"),
  "utf8",
);
const reminderSource = readFileSync(
  join(import.meta.dirname, "../app/(admitted)/reminders/open/page.tsx"),
  "utf8",
);
const accessSource = readFileSync(
  join(import.meta.dirname, "../lib/access/current-access.ts"),
  "utf8",
);

describe("AdmittedRoute shell contract", () => {
  it("prefetches one owner-neutral frame while fresh admission controls visibility", () => {
    expect(source).not.toContain('from "next/server"');
    expect(source).not.toContain("connection()");
    expect(source).not.toContain("requireAdmittedOwner");
    expect(source).not.toContain("<AppShell");

    const admission = layoutSource.indexOf("await hasAdmittedShellAccess");
    const appShell = layoutSource.indexOf("<AppShell");

    expect(admission).toBeGreaterThan(-1);
    expect(appShell).toBeGreaterThan(-1);
    expect(appShell).toBeLessThan(admission);
    expect(layoutSource).toContain("routeAwareMobileNavigation");
    expect(layoutSource).not.toContain("ownerUserId=");
    expect(layoutSource).toContain("data-admitted");
    expect(globalsSource).toContain(".admitted-layout:has(> [data-admitted])");
    expect(appShellSource).not.toContain("AppShellEffects");
    expect(layoutSource.indexOf("<AppShellEffects")).toBeGreaterThan(admission);
  });

  it("keeps exact destination gates and truthful Today/Review reserve beneath the frame", () => {
    expect(contactImportSource).toContain(
      'requireAdmittedOwner({ returnTo: "/account/contacts/import" })',
    );
    expect(reminderSource).toContain("signInPathFor(returnTo)");
    expect(homeSource).toContain("<MobileHomeReserve />");
    expect(homeReserveSource).toContain('=== "review"');
  });

  it("renders the route into one main and lets the destination own its mobile canvas", () => {
    // The shell must never resolve the destination from the URL to shape `<main>`:
    // that suspended the page canvas on `useSearchParams` and rendered the route
    // in both the fallback and the resolved branch.
    expect(mobileShellSource).not.toContain("RouteAwareMobileMain");
    expect(mobileShellSource.match(/<MobileRouteMain/g)).toHaveLength(1);
    expect(mobileShellSource).not.toContain("fallback={<MobileRouteMain");
    expect(globalsSource).toContain("main:has(> [data-mobile-bleed])");
    expect(homeSource).toContain("data-mobile-bleed");
  });

  it("prerenders one dashboard canvas that both Home tabs stream into", () => {
    // The canvas reads no request state, so it belongs to the static shell.
    for (const request of ["connection()", "searchParams", "requireAdmittedOwner", "await "]) {
      expect(dashboardFrameSource).not.toContain(request);
    }

    // Each region is its own boundary behind a reserve shaped like itself, and the
    // assistant never waits on the greeting or the rail.
    for (const reserve of [
      "<DashboardAssistantReserve />",
      "<DashboardGreetingReserve />",
      "<DashboardRailReserve />",
    ]) {
      expect(homeSource).toContain(reserve);
    }

    // Review is a rail tab over data the owner already holds, not a second
    // composition: the tab picks a panel, and no branch may swap the assistant
    // out for the spacer that used to leave the column empty on `?tab=review`.
    expect(homeSource).toContain("initialTab={tab}");
    expect(homeSource).not.toContain("hidden lg:block");
    expect(homeSource.match(/<HomeAssistant/g)).toHaveLength(1);
  });

  it("postpones the request-bound session read before initializing Better Auth", () => {
    const requestHeaders = accessSource.indexOf("await headers()");
    const authInitialization = accessSource.indexOf("getAuth().api.getSession");

    expect(requestHeaders).toBeGreaterThan(-1);
    expect(authInitialization).toBeGreaterThan(requestHeaders);
  });
});

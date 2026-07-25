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
  join(import.meta.dirname, "route-aware-home-reserve.tsx"),
  "utf8",
);
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
    expect(homeSource).toContain("<RouteAwareHomeReserve />");
    expect(homeReserveSource).toContain('? "Review" : "Today"');
  });

  it("postpones the request-bound session read before initializing Better Auth", () => {
    const requestHeaders = accessSource.indexOf("await headers()");
    const authInitialization = accessSource.indexOf("getAuth().api.getSession");

    expect(requestHeaders).toBeGreaterThan(-1);
    expect(authInitialization).toBeGreaterThan(requestHeaders);
  });
});

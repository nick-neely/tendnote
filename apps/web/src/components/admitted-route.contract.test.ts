import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "admitted-route.tsx"), "utf8");
const accessSource = readFileSync(
  join(import.meta.dirname, "../lib/access/current-access.ts"),
  "utf8",
);

describe("AdmittedRoute shell contract", () => {
  it("keeps admission ahead of the app frame without forcing the shared shell to runtime", () => {
    expect(source).not.toContain('from "next/server"');
    expect(source).not.toContain("connection()");

    const admission = source.indexOf("await requireAdmittedOwner");
    const appShell = source.indexOf("<AppShell");

    expect(admission).toBeGreaterThan(-1);
    expect(appShell).toBeGreaterThan(admission);
  });

  it("postpones the request-bound session read before initializing Better Auth", () => {
    const requestHeaders = accessSource.indexOf("await headers()");
    const authInitialization = accessSource.indexOf("getAuth().api.getSession");

    expect(requestHeaders).toBeGreaterThan(-1);
    expect(authInitialization).toBeGreaterThan(requestHeaders);
  });
});

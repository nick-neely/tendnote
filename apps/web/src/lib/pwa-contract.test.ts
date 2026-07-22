import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../app/manifest";

const serviceWorker = readFileSync(join(import.meta.dirname, "../../public/sw.js"), "utf8");
const offlineShell = readFileSync(
  join(import.meta.dirname, "../../public/offline-v1.html"),
  "utf8",
);

describe("Phase Seven installable online-required PWA", () => {
  it("launches the standalone app at Today with iOS and maskable icon metadata", () => {
    const value = manifest();
    expect(value).toMatchObject({
      display: "standalone",
      name: "Tendnote",
      short_name: "Tendnote",
      start_url: "/",
    });
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });

  it("caches only the versioned shell/offline assets and never queues authoritative traffic", () => {
    expect(serviceWorker).toContain('const SHELL_VERSION = "v1"');
    expect(serviceWorker).toContain('const SHELL_CACHE_PREFIX = "tendnote-shell-"');
    expect(serviceWorker).toContain("startsWith(SHELL_CACHE_PREFIX)");
    expect(serviceWorker).toContain("/_next/static/");
    expect(serviceWorker).toMatch(/\/offline-\$\{SHELL_VERSION\}\.html/);
    expect(serviceWorker).toContain("await notifyCacheMismatch()");
    expect(serviceWorker).toContain('request.method !== "GET"');
    expect(serviceWorker).toContain("/api/");
    expect(serviceWorker).toContain("/eve/");
    expect(serviceWorker).not.toContain('addEventListener("sync"');
    expect(serviceWorker).not.toContain("mutation-queue");
    expect(offlineShell).toContain("Tendnote needs a connection");
    expect(offlineShell).not.toMatch(/<(script|link)\b/i);
  });

  it("shows only generic reminder copy and opens its canonical record without mutation", () => {
    expect(serviceWorker).toContain('addEventListener("push"');
    expect(serviceWorker).toContain('showNotification("Tendnote reminder"');
    expect(serviceWorker).toContain("Open Tendnote to see what needs your attention.");
    expect(serviceWorker).toContain('addEventListener("notificationclick"');
    expect(serviceWorker).toContain("event.notification.close()");
    expect(serviceWorker).toContain("existing.navigate(target.href)");
    expect(serviceWorker).toContain("self.clients.openWindow(target.href)");
  });
});

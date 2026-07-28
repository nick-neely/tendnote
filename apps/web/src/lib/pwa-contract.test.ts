import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import manifest from "../app/manifest";

const serviceWorker = readFileSync(join(import.meta.dirname, "../../public/sw.js"), "utf8");
const offlineShell = readFileSync(
  join(import.meta.dirname, "../../public/offline-v2.html"),
  "utf8",
);
const publicDirectory = join(import.meta.dirname, "../../public");

function readPngSize(file: string) {
  const bytes = readFileSync(join(publicDirectory, file));
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
}

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
        expect.objectContaining({
          sizes: "192x192",
          src: "/icons/tendnote-192.png?asset=v2",
        }),
        expect.objectContaining({
          sizes: "512x512",
          purpose: "any",
          src: "/icons/tendnote-512.png?asset=v2",
        }),
        expect.objectContaining({
          sizes: "512x512",
          purpose: "maskable",
          src: "/icons/tendnote-maskable-512.png?asset=v2",
        }),
      ]),
    );
  });

  it("caches only the versioned shell/offline assets and never queues authoritative traffic", () => {
    expect(serviceWorker).toContain('const SHELL_VERSION = "v2"');
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
    expect(offlineShell).toContain("/icons/tendnote-mark-light.png?asset=v2");
    expect(offlineShell).toContain("/icons/tendnote-mark-dark.png?asset=v2");
    expect(offlineShell).not.toMatch(/<(script|link)\b/i);
  });

  it("ships the selected Tended Memory raster at each browser and install size", () => {
    const source = readFileSync(join(publicDirectory, "icons/tendnote-source.png"));
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "997d2d528de82ff76e89561db77fa709f45d74fc98bd5c083ad2c55673ed41f9",
    );
    expect(readPngSize("icons/tendnote-source.png")).toEqual({ height: 1254, width: 1254 });
    expect(readPngSize("icons/tendnote-mark-light.png")).toEqual({ height: 256, width: 256 });
    expect(readPngSize("icons/tendnote-mark-dark.png")).toEqual({ height: 256, width: 256 });
    expect(readPngSize("icons/tendnote-favicon-light.png")).toEqual({ height: 64, width: 64 });
    expect(readPngSize("icons/tendnote-favicon-dark.png")).toEqual({ height: 64, width: 64 });
    expect(readPngSize("icons/tendnote-192.png")).toEqual({ height: 192, width: 192 });
    expect(readPngSize("icons/tendnote-512.png")).toEqual({ height: 512, width: 512 });
    expect(readPngSize("icons/tendnote-maskable-512.png")).toEqual({
      height: 512,
      width: 512,
    });
    expect(readPngSize("icons/tendnote-badge-96.png")).toEqual({ height: 96, width: 96 });
  });

  it("shows only generic reminder copy and opens its canonical record without mutation", () => {
    expect(serviceWorker).toContain('addEventListener("push"');
    expect(serviceWorker).toContain('showNotification("Tendnote reminder"');
    expect(serviceWorker).toContain("Open Tendnote to see what needs your attention.");
    expect(serviceWorker).toMatch(/icon: `\/icons\/tendnote-192\.png\?asset=\$\{SHELL_VERSION\}`/);
    expect(serviceWorker).toMatch(
      /badge: `\/icons\/tendnote-badge-96\.png\?asset=\$\{SHELL_VERSION\}`/,
    );
    expect(serviceWorker).toContain('addEventListener("notificationclick"');
    expect(serviceWorker).toContain("event.notification.close()");
    expect(serviceWorker).toContain("existing.navigate(target.href)");
    expect(serviceWorker).toContain("self.clients.openWindow(target.href)");
  });

  it("refreshes destination configuration before falling back to an installed cache", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn(async () => {});
    const put = vi.fn(async () => {});
    const fetch = vi.fn(async () => Response.json({ notificationFallback: "/new-actions" }));
    const caches = {
      match: vi.fn(async () => Response.json({ notificationFallback: "/stale-actions" })),
      open: vi.fn(async () => ({ addAll: vi.fn(), put })),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
    };
    const self = {
      addEventListener: (name: string, listener: (event: unknown) => void) => {
        listeners.set(name, listener);
      },
      clients: {
        claim: vi.fn(),
        matchAll: vi.fn(async () => []),
        openWindow: vi.fn(),
      },
      location: { origin: "https://tendnote.test" },
      registration: { showNotification },
      skipWaiting: vi.fn(),
    };
    runInNewContext(serviceWorker, {
      Response,
      URL,
      caches,
      fetch,
      self,
    });
    let pending: Promise<unknown> | undefined;
    listeners.get("push")?.({
      data: null,
      waitUntil(value: Promise<unknown>) {
        pending = value;
      },
    });

    await pending;

    expect(fetch).toHaveBeenCalledWith("/app-destinations.json");
    expect(showNotification).toHaveBeenCalledWith(
      "Tendnote reminder",
      expect.objectContaining({ data: { url: "/new-actions" } }),
    );
    expect(put).toHaveBeenCalledWith("/app-destinations.json", expect.any(Response));
    expect(caches.match).not.toHaveBeenCalled();
  });
});

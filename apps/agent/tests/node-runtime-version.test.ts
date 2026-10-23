import { version } from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeVersionLogged = Symbol.for("tendnote.eve.node-runtime-version");
const runtime = globalThis as Record<symbol, boolean | undefined>;

afterEach(() => {
  delete runtime[runtimeVersionLogged];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock("node:process");
  vi.resetModules();
});

describe("Eve Node runtime startup evidence", () => {
  it("logs only the running version and service, without subscribing to request or turn events", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "runtime-test-sensitive-sentinel");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { default: hook } = await import("../agent/hooks/node-runtime-version");

    expect(log.mock.calls).toEqual([
      ["runtime.node_version", { service: "eve", nodeVersion: version }],
    ]);
    expect(hook.events).toEqual({});
  });

  it("reads the runtime process module instead of a configured patch pin", async () => {
    vi.doMock("node:process", () => ({ version: "v24.99.7" }));
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await import("../agent/hooks/node-runtime-version");
    expect(log).toHaveBeenCalledWith("runtime.node_version", {
      service: "eve",
      nodeVersion: "v24.99.7",
    });
  });

  it("does not repeat the log when another runtime module copy loads", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await import("../agent/hooks/node-runtime-version");
    vi.resetModules();
    await import("../agent/hooks/node-runtime-version");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("keeps Eve available if the log sink throws", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("log sink unavailable");
    });
    await expect(import("../agent/hooks/node-runtime-version")).resolves.toBeDefined();
    vi.resetModules();
    await import("../agent/hooks/node-runtime-version");
    expect(log).toHaveBeenCalledTimes(1);
  });
});

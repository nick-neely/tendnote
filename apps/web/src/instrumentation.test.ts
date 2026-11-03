import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/diagnostics/report", () => ({ reportServerError: vi.fn() }));

const runtimeVersionLogged = Symbol.for("tendnote.web.node-runtime-version");
const runtime = globalThis as Record<symbol, boolean | undefined>;

afterEach(() => {
  delete runtime[runtimeVersionLogged];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/diagnostics/node-runtime-version");
  vi.resetModules();
});

describe("Node runtime startup evidence", () => {
  it("logs only the service and running Node version when the server registers", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("STRIPE_SECRET_KEY", "runtime-test-sensitive-sentinel");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    expect(log).not.toHaveBeenCalled();

    await register();

    expect(log.mock.calls).toEqual([
      ["runtime.node_version", { service: "web", nodeVersion: process.version }],
    ]);
  });

  it.each(["edge", "", undefined])("does not log for runtime %s", async (nextRuntime) => {
    vi.stubEnv("NEXT_RUNTIME", nextRuntime);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await register();
    expect(log).not.toHaveBeenCalled();
    expect(runtime[runtimeVersionLogged]).toBeUndefined();
  });

  it("reads the executing process version instead of a configured patch pin", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    const descriptor = Object.getOwnPropertyDescriptor(process, "version");
    if (!descriptor) throw new Error("Node version descriptor unavailable");
    try {
      Object.defineProperty(process, "version", { value: "v24.99.7" });
      await register();
      expect(log).toHaveBeenCalledWith("runtime.node_version", {
        service: "web",
        nodeVersion: "v24.99.7",
      });
    } finally {
      Object.defineProperty(process, "version", descriptor);
    }
  });

  it("logs once even if registration or the instrumentation module is loaded again", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await register();
    await register();
    vi.resetModules();
    await (await import("./instrumentation")).register();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("keeps startup available if the log sink throws", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const log = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("log sink unavailable");
    });
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
    await register();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("keeps startup available if the diagnostic module cannot load or initialize", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.doMock("@/lib/diagnostics/node-runtime-version", () => {
      throw new Error("diagnostic module unavailable");
    });
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
    expect(runtime[runtimeVersionLogged]).toBeUndefined();
  });

  it("registers the signed queue transport reminder wake-ups publish through", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { registerBackgroundJobQueueTransport, registeredBackgroundJobQueueTransport } =
      await import("@tendnote/db/queries/background-job-deliveries");
    registerBackgroundJobQueueTransport(undefined);
    const { register } = await import("./instrumentation");

    await register();

    expect(registeredBackgroundJobQueueTransport()?.send).toEqual(expect.any(Function));
    registerBackgroundJobQueueTransport(undefined);
  });

  it("keeps startup available, and reminders on the cron, if the transport cannot load", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@/lib/background-jobs/vercel-queue-transport", () => {
      throw new Error("transport module unavailable");
    });
    const { register } = await import("./instrumentation");

    await expect(register()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("runtime.queue_transport_unavailable", { service: "web" });
    vi.doUnmock("@/lib/background-jobs/vercel-queue-transport");
  });

  it("leaves the existing server error reporter behind its Node runtime guard", async () => {
    const { onRequestError } = await import("./instrumentation");
    const { reportServerError } = await import("@/lib/diagnostics/report");
    const args = [new Error("synthetic"), {}, {}] as unknown as Parameters<typeof onRequestError>;

    vi.stubEnv("NEXT_RUNTIME", "edge");
    await onRequestError(...args);
    expect(reportServerError).not.toHaveBeenCalled();

    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await onRequestError(...args);
    expect(reportServerError).toHaveBeenCalledExactlyOnceWith(...args);
  });
});

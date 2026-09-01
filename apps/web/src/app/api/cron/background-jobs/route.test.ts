import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runBackgroundJobRecovery } = vi.hoisted(() => ({
  runBackgroundJobRecovery: vi.fn(),
}));
vi.mock("@/lib/background-jobs/recovery", () => ({ runBackgroundJobRecovery }));

import { GET } from "./route";

const SECRET = "cron-secret-value";

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/background-jobs", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runBackgroundJobRecovery.mockResolvedValue({ ok: true });
  // Default to the local-test environment with no opt-in.
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("ALLOW_UNAUTHENTICATED_CRON", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("background-jobs recovery cron route", () => {
  it("fails closed with 401 when CRON_SECRET is unset and no opt-in is present", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request("Bearer not-the-secret"));

    expect(response.status).toBe(401);
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
  });

  it("accepts the correct bearer token", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(runBackgroundJobRecovery).toHaveBeenCalledTimes(1);
  });

  it("allows the explicit development-only opt-in when no secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_UNAUTHENTICATED_CRON", "true");

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(runBackgroundJobRecovery).toHaveBeenCalledTimes(1);
  });

  it("ignores the opt-in in production and preview (fails closed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_UNAUTHENTICATED_CRON", "true");

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
  });
});

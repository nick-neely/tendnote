import { describe, expect, it, vi } from "vitest";
import { backupSurfaceReading, checkBackupSurfaces } from "./backup-surfaces";

const env = { NEON_API_KEY: "napi_test", NEON_PROJECT_ID: "proud-darkness-91591984" };
const now = new Date("2026-10-10T12:00:00.000Z");
const project = "https://console.neon.tech/api/v2/projects/proud-darkness-91591984";

function neon(routes: Record<string, unknown>) {
  return vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    const body = Object.entries(routes).find(([route]) => path === route)?.[1];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : Response.json(body, { status: 200 });
  });
}

const healthy = {
  [project]: { project: { history_retention_seconds: 604_800 } },
  [`${project}/snapshots`]: { snapshots: [] },
  [`${project}/branches?limit=10000`]: {
    branches: [
      {
        id: "br-production",
        name: "production",
        default: true,
        created_at: "2025-01-15T10:30:00Z",
      },
    ],
    pagination: { next: "br-production" },
  },
  [`${project}/branches?limit=10000&cursor=br-production`]: { branches: [] },
};

describe("checkBackupSurfaces", () => {
  it("is off unless both the Neon key and the project are set", async () => {
    const fetch = neon(healthy);
    await expect(checkBackupSurfaces({ env: {}, fetch, now })).resolves.toEqual({ status: "off" });
    await expect(
      checkBackupSurfaces({ env: { NEON_API_KEY: "napi_test" }, fetch, now }),
    ).resolves.toEqual({ status: "off" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the project with the key and finds nothing when every surface is inside the window", async () => {
    const fetch = neon(healthy);
    await expect(checkBackupSurfaces({ env, fetch, now })).resolves.toEqual({
      status: "ran",
      findings: [],
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [, init] of fetch.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer napi_test");
    }
  });

  it("flags drifted history, a snapshot with no expiry, and an over-age branch from Neon's answer", async () => {
    const fetch = neon({
      ...healthy,
      [project]: { project: { history_retention_seconds: 21_600 } },
      [`${project}/snapshots`]: {
        snapshots: [
          {
            id: "snap-planted",
            name: "planted",
            created_at: "2026-10-10T11:00:00Z",
            timestamp: "2026-10-10T10:59:00Z",
            manual: true,
          },
          {
            id: "snap-fine",
            name: "fine",
            created_at: "2026-10-09T00:00:00Z",
            expires_at: "2026-10-12T00:00:00Z",
          },
        ],
      },
      [`${project}/branches?limit=10000`]: {
        branches: [
          ...healthy[`${project}/branches?limit=10000`].branches,
          {
            id: "br-stale",
            name: "production_old_2026-09-30T08:00:00Z",
            default: false,
            created_at: "2025-01-15T10:30:00Z",
          },
        ],
      },
    });

    await expect(checkBackupSurfaces({ env, fetch, now })).resolves.toEqual({
      status: "ran",
      findings: [
        { surface: "history_window", configuredSeconds: 21_600, expectedSeconds: 604_800 },
        { surface: "snapshot", id: "snap-planted", name: "planted" },
        { surface: "branch", id: "br-stale", name: "production_old_2026-09-30T08:00:00Z" },
      ],
    });
  });

  it("follows Neon's cursor until a page comes back empty", async () => {
    const page = (id: string) => ({
      id,
      name: id,
      default: false,
      created_at: "2026-09-01T00:00:00Z",
    });
    const fetch = neon({
      ...healthy,
      [`${project}/branches?limit=10000`]: { branches: [page("br-a")], pagination: { next: "a" } },
      [`${project}/branches?limit=10000&cursor=a`]: {
        branches: [page("br-b")],
        pagination: { next: "b" },
      },
      [`${project}/branches?limit=10000&cursor=b`]: { branches: [], pagination: { next: "c" } },
    });

    await expect(checkBackupSurfaces({ env, fetch, now })).resolves.toEqual({
      status: "ran",
      findings: [
        { surface: "branch", id: "br-a", name: "br-a" },
        { surface: "branch", id: "br-b", name: "br-b" },
      ],
    });
  });

  it("throws rather than reporting no findings when Neon cannot be read", async () => {
    await expect(checkBackupSurfaces({ env, fetch: neon({}), now })).rejects.toThrow(
      "Neon answered 404.",
    );
    await expect(
      checkBackupSurfaces({
        env,
        fetch: neon({ ...healthy, [project]: { project: {} } }),
        now,
      }),
    ).rejects.toThrow(/history_retention_seconds/);
  });
});

describe("backupSurfaceReading", () => {
  it("logs each finding and passes the check on", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = neon({ ...healthy, [project]: { project: { history_retention_seconds: 0 } } });

    await expect(backupSurfaceReading({ env, fetch, now })).resolves.toEqual({
      status: "ran",
      findings: [{ surface: "history_window", configuredSeconds: 0, expectedSeconds: 604_800 }],
    });
    expect(log).toHaveBeenCalledWith("backup_surface.finding", {
      surface: "history_window",
      configuredSeconds: 0,
      expectedSeconds: 604_800,
    });
    log.mockRestore();
  });

  it("gives no reading when Neon cannot be read, logging only the error's kind", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(backupSurfaceReading({ env, fetch: neon({}), now })).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith("backup_surface.check_failed", { reason: "Error" });
    log.mockRestore();
  });
});

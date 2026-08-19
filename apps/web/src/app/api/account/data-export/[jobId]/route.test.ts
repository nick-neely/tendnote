import { beforeEach, describe, expect, it, vi } from "vitest";

const { admittedOwnerOrNull, getJob, markExpired, getArtifact } = vi.hoisted(() => ({
  admittedOwnerOrNull: vi.fn(),
  getJob: vi.fn(),
  markExpired: vi.fn().mockResolvedValue(null),
  getArtifact: vi.fn(),
}));

vi.mock("@/lib/access/current-access", () => ({ admittedOwnerOrNull }));
vi.mock("@tendnote/db/queries/owner-data-export", () => ({
  createDrizzleOwnerDataExportJobStore: () => ({ get: getJob, markExpired }),
  createDrizzleOwnerDataExportArtifactStore: () => ({ get: getArtifact }),
}));

import { GET } from "./route";

describe("owner data export download boundary", () => {
  beforeEach(() => {
    admittedOwnerOrNull.mockReset();
    getJob.mockReset();
    markExpired.mockReset().mockResolvedValue(null);
    getArtifact.mockReset();
  });

  it("returns the same opaque refusal for unauthenticated, unknown, and other-owner artifacts", async () => {
    admittedOwnerOrNull.mockResolvedValue(null);
    const unauthenticated = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(unauthenticated.status).toBe(404);

    admittedOwnerOrNull.mockResolvedValue("owner-2");
    getJob.mockResolvedValue(null);
    const unknown = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe(await unauthenticated.text());
    expect(getJob).toHaveBeenCalledWith({ jobId: "job-1", ownerUserId: "owner-2" });
  });

  it("rechecks the owner on every successful download and returns a private ZIP", async () => {
    admittedOwnerOrNull.mockResolvedValue("owner-1");
    getJob.mockResolvedValue({
      status: "completed",
      artifactExpiresAt: new Date("2026-08-20T12:00:00.000Z"),
    });
    getArtifact.mockResolvedValue({ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer);
    expect(getArtifact).toHaveBeenCalledWith({ jobId: "job-1", ownerUserId: "owner-1" });
  });

  it("makes expiry opaque and best-effort marks the job expired", async () => {
    admittedOwnerOrNull.mockResolvedValue("owner-1");
    getJob.mockResolvedValue({
      status: "completed",
      artifactExpiresAt: new Date("2026-08-20T12:00:00.000Z"),
    });
    getArtifact.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(404);
    expect(markExpired).toHaveBeenCalledWith({ jobId: "job-1" });
  });
});

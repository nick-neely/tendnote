import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  admittedOwnerOrNull,
  getJob,
  markExpired,
  markArtifactDeleted,
  getArtifact,
  deleteArtifact,
} = vi.hoisted(() => ({
  admittedOwnerOrNull: vi.fn(),
  getJob: vi.fn(),
  markExpired: vi.fn().mockResolvedValue(null),
  markArtifactDeleted: vi.fn().mockResolvedValue(null),
  getArtifact: vi.fn(),
  deleteArtifact: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/access/current-access", () => ({ admittedOwnerOrNull }));
vi.mock("@tendnote/db/queries/owner-data-export", () => ({
  createDrizzleOwnerDataExportJobStore: () => ({
    get: getJob,
    markExpired,
    markArtifactDeleted,
  }),
  createDrizzleOwnerDataExportArtifactStore: () => ({ get: getArtifact, delete: deleteArtifact }),
}));

import { GET } from "./route";

describe("owner data export download boundary", () => {
  beforeEach(() => {
    admittedOwnerOrNull.mockReset();
    getJob.mockReset();
    markExpired.mockReset().mockResolvedValue(null);
    markArtifactDeleted.mockReset().mockResolvedValue(null);
    getArtifact.mockReset();
    deleteArtifact.mockReset().mockResolvedValue(undefined);
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
      artifactExpiresAt: new Date("2999-08-20T12:00:00.000Z"),
    });
    getArtifact.mockResolvedValue({ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer);
    expect(getArtifact).toHaveBeenCalledWith({
      jobId: "job-1",
      ownerUserId: "owner-1",
      now: expect.any(Date),
    });
  });

  it("makes expiry opaque, marks it recoverably, and physically deletes the bytes", async () => {
    admittedOwnerOrNull.mockResolvedValue("owner-1");
    getJob.mockResolvedValue({
      status: "completed",
      artifactExpiresAt: new Date("2000-08-20T12:00:00.000Z"),
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(404);
    expect(markExpired).toHaveBeenCalledWith({ jobId: "job-1", now: expect.any(Date) });
    expect(deleteArtifact).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(markArtifactDeleted).toHaveBeenCalledWith({
      jobId: "job-1",
      now: expect.any(Date),
    });
    expect(getArtifact).not.toHaveBeenCalled();
  });

  it("keeps a pre-expiry missing artifact recoverable instead of falsely expiring it", async () => {
    admittedOwnerOrNull.mockResolvedValue("owner-1");
    getJob.mockResolvedValue({
      status: "completed",
      artifactExpiresAt: new Date("2999-08-20T12:00:00.000Z"),
    });
    getArtifact.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect(response.status).toBe(404);
    expect(markExpired).not.toHaveBeenCalled();
    expect(markArtifactDeleted).not.toHaveBeenCalled();
    expect(deleteArtifact).not.toHaveBeenCalled();
  });
});

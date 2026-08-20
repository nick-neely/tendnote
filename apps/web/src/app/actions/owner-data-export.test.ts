import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy, revalidatePathSpy } from "@/test/action-adapter-mocks";

const { getLatestOwnerDataExportJob, enqueueAndPublishOwnerDataExportJob } = vi.hoisted(() => ({
  getLatestOwnerDataExportJob: vi.fn(),
  enqueueAndPublishOwnerDataExportJob: vi.fn(),
}));

vi.mock("@tendnote/db/queries/owner-data-export", () => ({
  getLatestOwnerDataExportJob,
  ownerDataExportRequestIdempotencyKey: (latest: { id: string } | null) =>
    `owner-data-export:request-after:${latest?.id ?? "initial"}`,
}));
vi.mock("@/lib/background-jobs/owner-data-export-queue", () => ({
  enqueueAndPublishOwnerDataExportJob,
}));

import { requestOwnerDataExportAction } from "./owner-data-export";

const job = {
  id: "00000000-0000-4000-8000-000000000477",
  ownerUserId: "owner-1",
  status: "pending" as const,
  attempts: 0,
  lastError: null,
  idempotencyKey: "owner-data-export:request-after:initial",
  runAfter: new Date("2026-08-19T12:00:00.000Z"),
  claimedAt: null,
  claimToken: null,
  completedAt: null,
  artifactExpiresAt: null,
  createdAt: new Date("2026-08-19T12:00:00.000Z"),
  updatedAt: new Date("2026-08-19T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  getLatestOwnerDataExportJob.mockResolvedValue(null);
  enqueueAndPublishOwnerDataExportJob.mockResolvedValue({ job });
});

describe("requestOwnerDataExportAction", () => {
  it("derives owner identity server-side and gives concurrent retries one stable key", async () => {
    const [first, second] = await Promise.all([
      requestOwnerDataExportAction(),
      requestOwnerDataExportAction(),
    ]);

    expect(first).toEqual({ ok: true, view: job });
    expect(second).toEqual({ ok: true, view: job });
    expect(enqueueAndPublishOwnerDataExportJob).toHaveBeenCalledTimes(2);
    expect(enqueueAndPublishOwnerDataExportJob).toHaveBeenNthCalledWith(1, {
      ownerUserId: "owner-1",
      idempotencyKey: "owner-data-export:request-after:initial",
    });
    expect(enqueueAndPublishOwnerDataExportJob).toHaveBeenNthCalledWith(2, {
      ownerUserId: "owner-1",
      idempotencyKey: "owner-data-export:request-after:initial",
    });
    expect(requireAdmittedOwnerForActionSpy).toHaveBeenCalledTimes(2);
    expect(revalidatePathSpy).toHaveBeenCalledWith("/account");
  });

  it("returns the already-active owner job without creating another delivery", async () => {
    getLatestOwnerDataExportJob.mockResolvedValue(job);

    await expect(requestOwnerDataExportAction()).resolves.toEqual({ ok: true, view: job });

    expect(enqueueAndPublishOwnerDataExportJob).not.toHaveBeenCalled();
  });
});

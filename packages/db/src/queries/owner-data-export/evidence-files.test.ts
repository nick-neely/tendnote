import { beforeEach, expect, it, vi } from "vitest";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../file-uploads/blob", () => ({ readPrivateFile: read }));

import { loadEvidenceExportFiles } from "./evidence-files";

const row = {
  evidenceId: "evidence",
  ownerUserId: "owner",
  blobPath: "evidence/file",
  bytes: null,
};
beforeEach(() => vi.clearAllMocks());
it("rejects too many files before downloading any Blob", async () => {
  await expect(
    loadEvidenceExportFiles(
      Array.from({ length: 501 }, () => row),
      [{ id: "evidence", sizeBytes: 1 }],
    ),
  ).rejects.toThrow("export size limit");
  expect(read).not.toHaveBeenCalled();
});
it("rejects excess declared bytes before downloading any Blob", async () => {
  await expect(
    loadEvidenceExportFiles([row], [{ id: "evidence", sizeBytes: 129 * 1024 * 1024 }]),
  ).rejects.toThrow("export size limit");
  expect(read).not.toHaveBeenCalled();
});
it("downloads sequentially and preserves legacy file bytes", async () => {
  let active = 0;
  read.mockImplementation(async () => {
    active++;
    expect(active).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return new Uint8Array([7]);
  });
  const rows = [
    row,
    { ...row, evidenceId: "second" },
    { ...row, evidenceId: "legacy", blobPath: null, bytes: new Uint8Array([8]) },
  ];
  const files = await loadEvidenceExportFiles(
    rows,
    rows.map((r) => ({ id: r.evidenceId, sizeBytes: 1 })),
  );
  expect(files.map((f) => [f.evidenceId, ...f.bytes])).toEqual([
    ["evidence", 7],
    ["second", 7],
    ["legacy", 8],
  ]);
  expect(read).toHaveBeenCalledTimes(2);
});
it("rejects missing metadata before any downloads", async () => {
  await expect(loadEvidenceExportFiles([row], [])).rejects.toThrow("metadata");
  expect(read).not.toHaveBeenCalled();
});
it("rejects content that does not match its declared size", async () => {
  read.mockResolvedValue(new Uint8Array([1, 2]));
  await expect(loadEvidenceExportFiles([row], [{ id: "evidence", sizeBytes: 1 }])).rejects.toThrow(
    "size does not match",
  );
});

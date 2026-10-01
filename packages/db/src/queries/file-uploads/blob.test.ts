import { ASSET_EVIDENCE_MAX_FILE_BYTES } from "@tendnote/domain";
import { beforeEach, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get, put: vi.fn(), del: vi.fn() }));

import { readPrivateFile } from "./blob";

beforeEach(() => vi.resetAllMocks());
it("reads all chunks of a private file without enabling the provider cache", async () => {
  get.mockResolvedValue({
    statusCode: 200,
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    }),
  });
  expect(await readPrivateFile("uploads/owned-file")).toEqual(new Uint8Array([1, 2, 3]));
  expect(get).toHaveBeenCalledWith("uploads/owned-file", { access: "private", useCache: false });
});
it.each([null, { statusCode: 404 }])("rejects unavailable provider objects", async (response) => {
  get.mockResolvedValue(response);
  await expect(readPrivateFile("uploads/missing")).rejects.toThrow("File unavailable");
});
it("cancels oversized downloads instead of retaining unlimited bytes", async () => {
  const cancel = vi.fn();
  get.mockResolvedValue({
    statusCode: 200,
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(ASSET_EVIDENCE_MAX_FILE_BYTES + 1));
      },
      cancel,
    }),
  });
  await expect(readPrivateFile("uploads/oversize")).rejects.toThrow("size limit");
  expect(cancel).toHaveBeenCalledOnce();
});

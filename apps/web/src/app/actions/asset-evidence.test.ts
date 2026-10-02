import { assetEvidenceSchema, createAssetEvidenceSchema } from "@tendnote/domain";
import { beforeEach, expect, it, vi } from "vitest";
import "@/test/action-adapter-mocks";

const mocks = vi.hoisted(() => ({ read: vi.fn(), add: vi.fn() }));
vi.mock("@tendnote/db/queries/file-uploads", () => ({ fileUploadService: { read: mocks.read } }));
vi.mock("@tendnote/db/queries/assets", () => ({
  addAssetEvidence: mocks.add,
  addAssetEvidenceToNewAsset: vi.fn(),
  listAssetEvidenceCaptureTargets: vi.fn(),
  removeAssetEvidence: vi.fn(),
}));

import { addAssetEvidenceAction } from "./asset-evidence";

const id = "11111111-1111-4111-8111-111111111111";
const file = {
  fileName: "photo.png",
  mimeType: "image/png",
  sizeBytes: 4,
  bytes: new Uint8Array(4),
};
function form() {
  const data = new FormData();
  data.set("assetId", id);
  data.set("kind", "photo");
  data.set("label", "Appliance label");
  data.set("uploadedFileId", id);
  data.set("ownerUserId", "forged-owner");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(file);
  mocks.add.mockImplementation(async (input) => ({
    affectedScopes: [],
    result: assetEvidenceSchema.parse({
      ...createAssetEvidenceSchema.parse({ ...input, ...input.file }),
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  }));
});
it("resolves an uploaded file through the session owner and returns only an evidence view", async () => {
  const result = await addAssetEvidenceAction(form());
  expect(mocks.read).toHaveBeenCalledWith("owner-1", id);
  expect(mocks.add).toHaveBeenCalledWith(
    expect.objectContaining({ ownerUserId: "owner-1", assetId: id, file }),
  );
  expect(result).toMatchObject({ ok: true, view: { fileName: "photo.png", hasFile: true } });
  expect(JSON.stringify(result)).not.toContain('"bytes"');
});
it("refuses an unavailable or foreign upload before creating Asset evidence", async () => {
  mocks.read.mockResolvedValue(null);
  await expect(addAssetEvidenceAction(form())).rejects.toThrow("File unavailable");
  expect(mocks.add).not.toHaveBeenCalled();
});
it("preserves bounded multipart capture while old forms are in flight", async () => {
  const data = form();
  data.delete("uploadedFileId");
  data.set("file", new File([new Uint8Array(4)], "photo.png", { type: "image/png" }));
  expect(await addAssetEvidenceAction(data)).toMatchObject({ ok: true });
  expect(mocks.read).not.toHaveBeenCalled();
});

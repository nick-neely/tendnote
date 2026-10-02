import { describe, expect, it } from "vitest";
import { createFileUploadService, type FileUploadRecord } from "./file-uploads/service";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function fixture() {
  const rows = new Map<string, FileUploadRecord>();
  const blobs = new Map<string, Uint8Array>();
  const service = createFileUploadService(
    {
      async insert(row) {
        rows.set(row.id, row);
      },
      async find(id, ownerUserId) {
        const row = rows.get(id);
        return row?.ownerUserId === ownerUserId ? row : null;
      },
      async confirm(id, ownerUserId) {
        const row = rows.get(id);
        if (row?.ownerUserId === ownerUserId) row.ready = true;
      },
      async remove(id, ownerUserId) {
        if (rows.get(id)?.ownerUserId === ownerUserId) rows.delete(id);
      },
    },
    {
      async read(path) {
        const bytes = blobs.get(path);
        if (!bytes) throw new Error("File unavailable");
        return bytes;
      },
    },
  );
  return { service, blobs };
}
describe("private uploads", () => {
  it("only makes a validated upload readable to its owner", async () => {
    const { service, blobs } = fixture();
    const reservation = await service.reserve("alice", {
      fileName: "receipt.png",
      mimeType: "image/png",
      sizeBytes: png.length,
    });
    blobs.set(reservation.pathname, png);
    expect(await service.read("bob", reservation.id)).toBeNull();
    expect(await service.read("alice", reservation.id)).toBeNull();
    await service.complete("alice", reservation.id);
    expect((await service.read("alice", reservation.id))?.bytes).toEqual(png);
    await service.remove("alice", reservation.id);
    expect(await service.read("alice", reservation.id)).toBeNull();
  });
});
it("rejects forged signatures and declared sizes without exposing bytes", async () => {
  const { service, blobs } = fixture();
  const row = await service.reserve("alice", {
    fileName: "fake.png",
    mimeType: "image/png",
    sizeBytes: 8,
  });
  blobs.set(row.pathname, new Uint8Array(8));
  await expect(service.complete("alice", row.id)).rejects.toThrow();
  expect(await service.read("alice", row.id)).toBeNull();
  blobs.set(row.pathname, new Uint8Array(9));
  await expect(service.complete("alice", row.id)).rejects.toThrow("size");
});
it("refuses foreign upload completion, deletion, and token requests", async () => {
  const { service, blobs } = fixture();
  const row = await service.reserve("alice", {
    fileName: "photo.png",
    mimeType: "image/png",
    sizeBytes: 8,
  });
  blobs.set(row.pathname, png);
  await expect(service.complete("bob", row.id)).rejects.toThrow();
  await expect(service.authorize("bob", row.id, row.pathname)).rejects.toThrow();
  await expect(service.authorize("alice", row.id, "uploads/foreign")).rejects.toThrow();
  await service.remove("bob", row.id);
  await service.complete("alice", row.id);
  expect((await service.read("alice", row.id))?.bytes).toEqual(png);
  await expect(service.authorize("alice", row.id, row.pathname)).rejects.toThrow();
});

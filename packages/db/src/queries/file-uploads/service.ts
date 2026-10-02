import { randomUUID } from "node:crypto";
import {
  assertAssetEvidenceFileAccepted,
  assertAssetEvidenceFileSignature,
} from "@tendnote/domain";

export type FileUploadRecord = {
  id: string;
  ownerUserId: string;
  pathname: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  ready: boolean;
  createdAt: Date;
};
export type FileUploadStore = {
  insert(row: FileUploadRecord): Promise<void>;
  find(id: string, ownerUserId: string): Promise<FileUploadRecord | null>;
  confirm(id: string, ownerUserId: string): Promise<void>;
  remove(id: string, ownerUserId: string): Promise<void>;
};
export type FileBytesReader = { read(pathname: string): Promise<Uint8Array> };

/** Browser-supplied URLs and owner ids never select storage objects. */
export function createFileUploadService(store: FileUploadStore, files: FileBytesReader) {
  async function pending(ownerUserId: string, id: string) {
    const row = await store.find(id, ownerUserId);
    if (!row || (!row.ready && Date.now() - row.createdAt.getTime() > 15 * 60_000)) {
      throw new Error("File unavailable. Attach it again.");
    }
    return row;
  }
  return {
    async reserve(
      ownerUserId: string,
      file: Pick<FileUploadRecord, "fileName" | "mimeType" | "sizeBytes">,
    ) {
      assertAssetEvidenceFileAccepted(file);
      const fileName = file.fileName
        .trim()
        .replace(/[\r\n]/g, "")
        .slice(0, 240);
      if (!fileName || !Number.isSafeInteger(file.sizeBytes)) throw new Error("Invalid file.");
      const id = randomUUID();
      const row: FileUploadRecord = {
        ...file,
        fileName,
        id,
        ownerUserId,
        pathname: `uploads/${id}`,
        ready: false,
        createdAt: new Date(),
      };
      await store.insert(row);
      return row;
    },
    async authorize(ownerUserId: string, id: string, pathname: string) {
      const row = await pending(ownerUserId, id);
      if (row.ready || row.pathname !== pathname) throw new Error("File unavailable.");
      return row;
    },
    async complete(ownerUserId: string, id: string) {
      const row = await pending(ownerUserId, id);
      if (!row.ready) {
        const bytes = await files.read(row.pathname);
        if (bytes.byteLength !== row.sizeBytes) throw new Error("File size does not match.");
        assertAssetEvidenceFileSignature({ mimeType: row.mimeType, bytes });
        await store.confirm(id, ownerUserId);
      }
      return {
        id: row.id,
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
      };
    },
    async read(ownerUserId: string, id: string) {
      const row = await store.find(id, ownerUserId);
      if (!row?.ready) return null;
      return { ...row, bytes: await files.read(row.pathname) };
    },
    async remove(ownerUserId: string, id: string) {
      await store.remove(id, ownerUserId);
    },
  };
}

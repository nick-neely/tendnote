import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { fileUploads } from "../../schema";
import { readPrivateFile } from "../file-uploads/blob";
import { jsonBytes } from "./shared";
import type { OwnerDataExportResource } from "./types";

export async function ownerUploadExport(ownerUserId: string) {
  const rows = await getDb()
    .select()
    .from(fileUploads)
    .where(and(eq(fileUploads.ownerUserId, ownerUserId), eq(fileUploads.ready, true)))
    .orderBy(fileUploads.createdAt);
  // Fail before downloading an unbounded account. The existing archive has a 256 MiB ceiling.
  if (rows.length > 500 || rows.reduce((sum, row) => sum + row.sizeBytes, 0) > 128 * 1024 * 1024)
    throw new Error("Uploaded files exceed the export size limit.");
  const entries: { path: string; bytes: Uint8Array }[] = [];
  const resources: OwnerDataExportResource[] = [];
  for (const row of rows) {
    const path = `files/chat/${row.id}`;
    const bytes = await readPrivateFile(row.pathname);
    entries.push({ path, bytes });
    resources.push({
      path,
      schemaVersion: "1.0",
      contentType: "application/octet-stream",
      byteCount: bytes.byteLength,
    });
  }
  const path = "resources/chat/uploads-v1.json";
  entries.push({
    path,
    bytes: jsonBytes({
      schemaVersion: "1.0",
      records: rows.map(({ id, fileName, mimeType, sizeBytes, createdAt }) => ({
        id,
        fileName,
        mimeType,
        sizeBytes,
        createdAt,
        filePath: `files/chat/${id}`,
      })),
    }),
  });
  resources.push({
    path,
    schemaVersion: "1.0",
    contentType: "application/json",
    recordCount: rows.length,
  });
  return { entries, resources, families: ["chat attachments"] };
}

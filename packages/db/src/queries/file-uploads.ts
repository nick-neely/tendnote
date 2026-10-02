import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../client";
import { blobDeletions, fileUploads } from "../schema";
import { deletePrivateFile, readPrivateFile } from "./file-uploads/blob";
import { createFileUploadService } from "./file-uploads/service";

export const fileUploadService = createFileUploadService(
  {
    async insert(row) {
      await getDb().insert(fileUploads).values(row);
    },
    async find(id, ownerUserId) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const [row] = await getDb()
        .select()
        .from(fileUploads)
        .where(and(eq(fileUploads.id, id), eq(fileUploads.ownerUserId, ownerUserId)))
        .limit(1);
      return row ?? null;
    },
    async confirm(id, ownerUserId) {
      await getDb()
        .update(fileUploads)
        .set({ ready: true })
        .where(and(eq(fileUploads.id, id), eq(fileUploads.ownerUserId, ownerUserId)));
    },
    async remove(id, ownerUserId) {
      await getDb()
        .delete(fileUploads)
        .where(and(eq(fileUploads.id, id), eq(fileUploads.ownerUserId, ownerUserId)));
    },
  },
  { read: readPrivateFile },
);

/** Deletion failures stay queued. Access disappears immediately when the metadata is removed. */
export async function sweepFileStorage(limit = 100) {
  await getDb()
    .delete(fileUploads)
    .where(
      and(
        eq(fileUploads.ready, false),
        lt(fileUploads.createdAt, new Date(Date.now() - 24 * 60 * 60_000)),
      ),
    );
  const rows = await getDb()
    .select()
    .from(blobDeletions)
    .where(lt(blobDeletions.createdAt, new Date(Date.now() - 60 * 60_000)))
    .orderBy(blobDeletions.createdAt)
    .limit(limit);
  let deleted = 0;
  for (const row of rows) {
    try {
      await deletePrivateFile(row.pathname);
      await getDb().delete(blobDeletions).where(eq(blobDeletions.pathname, row.pathname));
      deleted++;
    } catch {
      /* Keep the durable tombstone for the next recovery pass. */
    }
  }
  return { deleted, pending: rows.length - deleted };
}

import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "./client";
import { readPrivateFile, writePrivateFile } from "./queries/file-uploads/blob";
import { assetEvidence, assetEvidenceFiles, blobDeletions } from "./schema";

/** Run explicitly after the schema migration and Blob credentials are configured.
 * Each file is checksum-verified before its legacy bytes are cleared. Restartable.
 */
const db = getDb();
const rows = await db
  .select({
    id: assetEvidenceFiles.id,
    bytes: assetEvidenceFiles.bytes,
    mimeType: assetEvidence.mimeType,
  })
  .from(assetEvidenceFiles)
  .innerJoin(assetEvidence, eq(assetEvidence.id, assetEvidenceFiles.evidenceId))
  .where(and(isNull(assetEvidenceFiles.blobPath), isNotNull(assetEvidenceFiles.bytes)))
  .limit(100);
let migrated = 0;
for (const row of rows) {
  if (!row.bytes) continue;
  const path = `evidence/migrated-${row.id}-${randomUUID()}`;
  await db.insert(blobDeletions).values({ pathname: path }).onConflictDoNothing();
  await writePrivateFile(path, row.bytes, row.mimeType ?? "application/octet-stream");
  const stored = await readPrivateFile(path);
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  if (digest(stored) !== digest(row.bytes))
    throw new Error(`Checksum mismatch for evidence file ${row.id}`);
  await db.transaction(async (tx) => {
    const changed = await tx
      .update(assetEvidenceFiles)
      .set({ blobPath: path, bytes: null })
      .where(and(eq(assetEvidenceFiles.id, row.id), isNull(assetEvidenceFiles.blobPath)))
      .returning({ id: assetEvidenceFiles.id });
    if (changed.length) await tx.delete(blobDeletions).where(eq(blobDeletions.pathname, path));
  });
  migrated++;
}
console.log(
  JSON.stringify({
    migrated,
    batchLimit: 100,
    next: migrated ? "Run again until migrated is zero." : "No legacy files remain in this batch.",
  }),
);
process.exit(0);

import { readPrivateFile } from "../file-uploads/blob";

type EvidenceFile = {
  evidenceId: string;
  ownerUserId: string;
  blobPath: string | null;
  bytes: Uint8Array | null;
};

/** Check the whole file set before network I/O, then download one file at a time. */
export async function loadEvidenceExportFiles(
  rows: EvidenceFile[],
  evidence: { id: string; sizeBytes: number | null }[],
) {
  if (rows.length > 500) throw new Error("Evidence files exceed the export size limit.");
  const sizes = new Map(evidence.map((row) => [row.id, row.sizeBytes]));
  let total = 0;
  for (const row of rows) {
    const size = sizes.get(row.evidenceId);
    if (size == null || !Number.isSafeInteger(size) || size <= 0)
      throw new Error("Evidence file metadata is unavailable for export.");
    total += size;
  }
  if (total > 128 * 1024 * 1024) throw new Error("Evidence files exceed the export size limit.");
  const files = [];
  for (const row of rows) {
    const bytes = row.blobPath ? await readPrivateFile(row.blobPath) : row.bytes;
    if (!bytes) throw new Error("An evidence file is unavailable for export.");
    if (bytes.byteLength !== sizes.get(row.evidenceId))
      throw new Error("Evidence file size does not match its metadata.");
    files.push({ evidenceId: row.evidenceId, ownerUserId: row.ownerUserId, bytes });
  }
  return files;
}

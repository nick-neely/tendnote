import { ASSET_EVIDENCE_MAX_FILE_BYTES } from "@tendnote/domain";
import { del, get, put } from "@vercel/blob";

/** Never fetch an arbitrary caller-supplied URL. All callers pass a database-owned path. */
export async function readPrivateFile(pathname: string): Promise<Uint8Array> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (result?.statusCode !== 200) throw new Error("File unavailable.");
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > ASSET_EVIDENCE_MAX_FILE_BYTES) throw new Error("File exceeds the size limit.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function writePrivateFile(pathname: string, bytes: Uint8Array, mimeType: string) {
  await put(pathname, Buffer.from(bytes), {
    access: "private",
    addRandomSuffix: false,
    contentType: mimeType,
  });
}
export async function deletePrivateFile(pathname: string) {
  await del(pathname);
}
